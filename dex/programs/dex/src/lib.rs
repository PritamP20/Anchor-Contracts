use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, instruction::Instruction};
use anchor_spl::token::{Token, TokenAccount, Transfer};

declare_id!("G8GU4fpCB4XuGbZLTo3iW2QrhQZzPMqQhbd4WxpYWi8P");

const JUPITER_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

#[program]
pub mod dex {
    use super::*;

    pub fn commit_swap(ctx: Context<CommitSwap>, commitment: [u8; 32]) -> Result<()> {
        let session = &mut ctx.accounts.session;
        session.user = ctx.accounts.user.key();
        session.commitment = commitment;
        session.revealed = false;
        session.bump = ctx.bumps.session;
        
        msg!("Swap committed from: {:?}", ctx.program_id);
        Ok(())
    }

    pub fn store_jupiter_instruction(
        ctx: Context<StoreJupiterInstruction>, 
        instruction_data: Vec<u8>
    ) -> Result<()> {
        let ix_account = &mut ctx.accounts.instruction_account;
        ix_account.user = ctx.accounts.user.key();
        ix_account.data = instruction_data;
        ix_account.bump = ctx.bumps.instruction_account;
        msg!("Jupiter instruction stored");
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reveal_and_swap(
        ctx: Context<RevealSwap>,
        salt: [u8; 32],
        token_in: Pubkey,
        token_out: Pubkey,
        amount: u64,
        jupiter_ix_data: Vec<u8>,
    ) -> Result<()> {
        let user_key = ctx.accounts.session.user;
        let session_bump = ctx.accounts.session.bump;
        let commitment = ctx.accounts.session.commitment;
        let is_revealed = ctx.accounts.session.revealed;
        
        require!(user_key == ctx.accounts.user.key(), CustomError::Unauthorized);
        require!(!is_revealed, CustomError::AlreadyRevealed);

        let mut buf = token_in.as_ref().to_vec();
        buf.extend(token_out.as_ref());
        buf.extend(&amount.to_le_bytes());
        buf.extend(&salt);
        let hash = anchor_lang::solana_program::keccak::hash(&buf).0;
        require!(hash == commitment, CustomError::CommitmentMismatch);

        let session = &mut ctx.accounts.session;
        session.revealed = true;

        if !jupiter_ix_data.is_empty() {
            let ix: Instruction = bincode::deserialize(&jupiter_ix_data)
                .map_err(|_| CustomError::DeserializeFailed)?;

            require!(ix.program_id == JUPITER_PROGRAM_ID, CustomError::InvalidJupiterInstruction);
            
            // Execute the Jupiter swap with session as signer
            invoke_signed(
                &ix,
                &ctx.remaining_accounts,
                &[&[b"session", user_key.as_ref(), &[session_bump]]],
            ).map_err(|_| CustomError::JupiterSwapFailed)?;

            msg!("Jupiter swap executed successfully");
        } else {
            msg!("No Jupiter instruction provided - skipping swap execution");
        }

        msg!("Swap revealed and processed successfully");
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reveal_and_swap_with_stored_ix(
        ctx: Context<RevealSwapWithStoredIx>,
        salt: [u8; 32],
        token_in: Pubkey,
        token_out: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let user_key = ctx.accounts.session.user;
        let session_bump = ctx.accounts.session.bump;
        let commitment = ctx.accounts.session.commitment;
        let is_revealed = ctx.accounts.session.revealed;
        
        require!(user_key == ctx.accounts.user.key(), CustomError::Unauthorized);
        require!(!is_revealed, CustomError::AlreadyRevealed);

        let mut buf = token_in.as_ref().to_vec();
        buf.extend(token_out.as_ref());
        buf.extend(&amount.to_le_bytes());
        buf.extend(&salt);
        let hash = anchor_lang::solana_program::keccak::hash(&buf).0;
        require!(hash == commitment, CustomError::CommitmentMismatch);

        let session = &mut ctx.accounts.session;
        session.revealed = true;

        let ix_account = &ctx.accounts.instruction_account;
        if !ix_account.data.is_empty() {
            let ix: Instruction = bincode::deserialize(&ix_account.data)
                .map_err(|_| CustomError::DeserializeFailed)?;

            require!(ix.program_id == JUPITER_PROGRAM_ID, CustomError::InvalidJupiterInstruction);
            
            invoke_signed(
                &ix,
                &ctx.remaining_accounts,
                &[&[b"session", user_key.as_ref(), &[session_bump]]],
            ).map_err(|_| CustomError::JupiterSwapFailed)?;

            msg!("Jupiter swap executed successfully");
        }

        Ok(())
    }

    pub fn cancel_commitment(ctx: Context<CancelCommitment>) -> Result<()> {
        let session = &mut ctx.accounts.session;
        require!(session.user == ctx.accounts.user.key(), CustomError::Unauthorized);
        session.commitment = [0u8; 32];
        session.revealed = false;
        msg!("Commitment cancelled");
        Ok(())
    }
    pub fn collect_protocol_fee(
        ctx: Context<CollectProtocolFee>,
        amount: u64,
    ) -> Result<()> {
        let session = &ctx.accounts.session;
        require!(session.revealed, CustomError::SwapNotRevealed);
        require!(session.user == ctx.accounts.user.key(), CustomError::Unauthorized);

        let fee_amount = amount / 1000; // 0.1% fee
        
        if fee_amount > 0 && ctx.accounts.source_token_account.amount >= fee_amount {
            let user_key = session.user;
            let session_bump = session.bump;
            let signer_seeds: &[&[u8]] = &[b"session", user_key.as_ref(), &[session_bump]];
            let signers: &[&[&[u8]]] = &[signer_seeds];
            
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.source_token_account.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.session.to_account_info(),
                },
                signers,
            );
            
            anchor_spl::token::transfer(cpi_ctx, fee_amount)?;
            msg!("Protocol fee collected: {}", fee_amount);
        }

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32])]
pub struct CommitSwap<'info> {
    #[account(
        init_if_needed,
        payer = user,
        seeds = [b"session", user.key().as_ref()],
        bump,
        space = 8 + 32 + 32 + 1 + 1
    )]
    pub session: Account<'info, SwapSession>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(instruction_data: Vec<u8>)]
pub struct StoreJupiterInstruction<'info> {
    #[account(
        init_if_needed,
        payer = user,
        seeds = [b"jupiter_ix", user.key().as_ref()],
        bump,
        space = 8 + 32 + 4 + instruction_data.len() + 1
    )]
    pub instruction_account: Account<'info, JupiterInstructionAccount>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(salt: [u8; 32], token_in: Pubkey, token_out: Pubkey, amount: u64, jupiter_ix_data: Vec<u8>)]
pub struct RevealSwap<'info> {
    #[account(
        mut,
        seeds = [b"session", user.key().as_ref()],
        bump = session.bump
    )]
    pub session: Account<'info, SwapSession>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(salt: [u8; 32], token_in: Pubkey, token_out: Pubkey, amount: u64)]
pub struct RevealSwapWithStoredIx<'info> {
    #[account(
        mut,
        seeds = [b"session", user.key().as_ref()],
        bump = session.bump
    )]
    pub session: Account<'info, SwapSession>,

    #[account(
        seeds = [b"jupiter_ix", user.key().as_ref()],
        bump = instruction_account.bump
    )]
    pub instruction_account: Account<'info, JupiterInstructionAccount>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelCommitment<'info> {
    #[account(
        mut,
        seeds = [b"session", user.key().as_ref()],
        bump = session.bump
    )]
    pub session: Account<'info, SwapSession>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct CollectProtocolFee<'info> {
    #[account(
        seeds = [b"session", user.key().as_ref()],
        bump = session.bump
    )]
    pub session: Account<'info, SwapSession>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub source_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct SwapSession {
    pub user: Pubkey,
    pub commitment: [u8; 32],
    pub revealed: bool,
    pub bump: u8,
}

#[account]
pub struct JupiterInstructionAccount {
    pub user: Pubkey,
    pub data: Vec<u8>,
    pub bump: u8,
}

#[error_code]
pub enum CustomError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Already revealed")]
    AlreadyRevealed,
    #[msg("Commitment mismatch")]
    CommitmentMismatch,
    #[msg("Deserialization failed")]
    DeserializeFailed,
    #[msg("Invalid Jupiter instruction")]
    InvalidJupiterInstruction,
    #[msg("Jupiter swap failed")]
    JupiterSwapFailed,
    #[msg("Swap not revealed yet")]
    SwapNotRevealed,
}