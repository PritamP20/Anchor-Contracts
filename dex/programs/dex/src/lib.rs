use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_spl::token::{Token, TokenAccount, Transfer};
use jupiter_cpi::cpi::accounts::SharedAccountsRoute;
use jupiter_cpi::cpi::shared_accounts_route;
use jupiter_cpi::ID as JUPITER_PROGRAM_ID;

declare_id!("76j3Mhhr64JU2Lj1FMV1dPErgmJMVgpPcm19nyx1XHDF");

#[program]
pub mod dex {
    use super::*;

    pub fn commit_swap(ctx: Context<CommitSwap>, commitment: [u8; 32]) -> Result<()> {
        let session = &mut ctx.accounts.session;
        session.user = ctx.accounts.user.key();
        session.commitment = commitment;
        session.revealed = false;
        session.bump = ctx.bumps.session;

        msg!("Swap committed");
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn reveal_and_swap(
        ctx: Context<RevealSwap>,
        salt: [u8; 32],
        token_in: Pubkey,
        token_out: Pubkey,
        amount: u64,
        id: u64,
        route_plan: Vec<jupiter_cpi::RoutePlanStep>,
        quoted_out_amount: u64,
        slippage_bps: u16,
        platform_fee_bps: u8,
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
        let hash = keccak::hash(&buf).0;
        require!(hash == commitment, CustomError::CommitmentMismatch);

        ctx.accounts.session.revealed = true;

        let signer_seeds: &[&[u8]] = &[b"session", user_key.as_ref(), &[session_bump]];
        let signers = &[signer_seeds];

        let accounts = SharedAccountsRoute {
            token_program: ctx.accounts.token_program.to_account_info(),
            program_authority: ctx.accounts.session.to_account_info(),
            user_transfer_authority: ctx.accounts.user_transfer_authority.to_account_info(),
            source_token_account: ctx.accounts.source_token_account.to_account_info(),
            program_source_token_account: ctx.accounts.program_source_token_account.to_account_info(),
            program_destination_token_account: ctx.accounts.program_destination_token_account.to_account_info(),
            destination_token_account: ctx.accounts.destination_token_account.to_account_info(),
            source_mint: ctx.accounts.source_mint.to_account_info(),
            destination_mint: ctx.accounts.destination_mint.to_account_info(),
            platform_fee_account: ctx.accounts.platform_fee_account.to_account_info(),
            token_2022_program: ctx.accounts.token_2022_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.jupiter_program.to_account_info(),
            accounts,
            signers,
        );

        shared_accounts_route(
            cpi_ctx,
            id,
            route_plan,
            amount,
            quoted_out_amount,
            slippage_bps,
            platform_fee_bps,
        ).map_err(|_| CustomError::JupiterSwapFailed)?;

        msg!("Jupiter swap executed successfully");
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

    pub fn collect_protocol_fee(ctx: Context<CollectProtocolFee>, amount: u64) -> Result<()> {
        let session = &ctx.accounts.session;
        require!(session.revealed, CustomError::SwapNotRevealed);
        require!(session.user == ctx.accounts.user.key(), CustomError::Unauthorized);

        let fee_amount = amount / 1000; // 0.1% fee

        if fee_amount > 0 && ctx.accounts.source_token_account.amount >= fee_amount {
            let signer_seeds: &[&[u8]] =
                &[b"session", session.user.as_ref(), &[session.bump]];
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
#[instruction(salt: [u8; 32], token_in: Pubkey, token_out: Pubkey, amount: u64)]
pub struct RevealSwap<'info> {
    #[account(
        mut,
        seeds = [b"session", user.key().as_ref()],
        bump = session.bump
    )]
    pub session: Account<'info, SwapSession>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub jupiter_program: Program<'info, jupiter_cpi::program::Jupiter>,
    pub token_program: Program<'info, Token>,
    pub user_transfer_authority: AccountInfo<'info>,
    pub source_token_account: Account<'info, TokenAccount>,
    pub program_source_token_account: Account<'info, TokenAccount>,
    pub program_destination_token_account: Account<'info, TokenAccount>,
    pub destination_token_account: Account<'info, TokenAccount>,
    pub source_mint: AccountInfo<'info>,
    pub destination_mint: AccountInfo<'info>,
    pub platform_fee_account: Account<'info, TokenAccount>,
    pub token_2022_program: AccountInfo<'info>,

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

#[error_code]
pub enum CustomError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Already revealed")]
    AlreadyRevealed,
    #[msg("Commitment mismatch")]
    CommitmentMismatch,
    #[msg("Jupiter swap failed")]
    JupiterSwapFailed,
    #[msg("Swap not revealed yet")]
    SwapNotRevealed,
}

