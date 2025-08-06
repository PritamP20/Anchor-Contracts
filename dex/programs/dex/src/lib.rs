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

    #[allow(clippy::too_many_arguments)]
    pub fn reveal_and_swap(
        ctx: Context<RevealSwap>,
        salt: [u8; 32],
        token_in: Pubkey,
        token_out: Pubkey,
        amount: u64,
        jupiter_ix: Vec<u8>,
    ) -> Result<()> {
        let session = &mut ctx.accounts.session;
        require!(session.user == ctx.accounts.user.key(), CustomError::Unauthorized);
        require!(!session.revealed, CustomError::AlreadyRevealed);

        // Validate commitment
        let mut buf = token_in.as_ref().to_vec();
        buf.extend(token_out.as_ref());
        buf.extend(&amount.to_le_bytes());
        buf.extend(&salt);
        let hash = anchor_lang::solana_program::keccak::hash(&buf).0;
        require!(hash == session.commitment, CustomError::CommitmentMismatch);

        session.revealed = true;

        // Execute Jupiter swap via CPI
        let ix: Instruction = bincode::deserialize(&jupiter_ix)
            .map_err(|_| CustomError::DeserializeFailed)?;
        
        // Validate Jupiter instruction program ID for security
        require!(ix.program_id == JUPITER_PROGRAM_ID, CustomError::InvalidJupiterInstruction);
        
        let bump = session.bump;
        let user_key = session.user;
        
        invoke_signed(
            &ix,
            &ctx.remaining_accounts,
            &[&[b"session", user_key.as_ref(), &[bump]]],
        )?;

        // Collect protocol fee (0.1% of amount)
        let fee_amount = amount / 1000;
        
        if fee_amount > 0 {
            let signer_seeds:&[&[u8]] = &[b"session", user_key.as_ref(), &[bump]];
            let signers:&[&[&[u8]]] = &[signer_seeds];
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.out_token_account.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.session.to_account_info(),
                },
                signers,
            );
            anchor_spl::token::transfer(cpi_ctx, fee_amount)?;
        }

        Ok(())
    }

    pub fn cancel_commitment(ctx: Context<CancelCommitment>) -> Result<()> {
        let session = &mut ctx.accounts.session;
        require!(session.user == ctx.accounts.user.key(), CustomError::Unauthorized);
        session.commitment = [0u8; 32];
        session.revealed = false;
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
        space = 8 + 32 + 32 + 1 + 1 // discriminator + user + commitment + revealed + bump
    )]
    pub session: Account<'info, SwapSession>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(salt: [u8; 32], token_in: Pubkey, token_out: Pubkey, amount: u64, jupiter_ix: Vec<u8>)]
pub struct RevealSwap<'info> {
    #[account(
        mut,
        seeds = [b"session", user.key().as_ref()],
        bump = session.bump
    )]
    pub session: Account<'info, SwapSession>,
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(address = JUPITER_PROGRAM_ID)]
    /// CHECK: Jupiter program address is verified via constraint
    pub jupiter_program: AccountInfo<'info>,

    #[account(mut)]
    pub out_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
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

#[account]
pub struct SwapSession {
    pub user: Pubkey,
    pub commitment: [u8; 32],
    pub revealed: bool,
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
}


// G8GU4fpCB4XuGbZLTo3iW2QrhQZzPMqQhbd4WxpYWi8P