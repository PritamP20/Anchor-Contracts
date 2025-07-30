use anchor_lang::prelude::*;

declare_id!("GvZmCQpJiixK5nk9f33ywxn7DGNtachK9GcrMPN1vne6");

const POINTS_PER_SOL_PER_DAY: u64 = 1_000_000;
const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
const SECONDS_PER_DAY: u64 = 86_400;

#[program]
pub mod stacking_contract_hk {
    use super::*;

    pub fn create_pda_account(ctx: Context<Initialize>) -> Result<()> {
        let pda_account = &mut ctx.accouts.pda_account; // so this account anchor will create rught acc to the instruction 
        let clock = Clock::get()?
        pda_account.owner = ctx.accounts.payer.key();
        pda_account.staked_amount = 0;
        pda_account.total_points = 0;
        pda_account.last_update_time = clock.unix_timestamp;
        pda_account.bump = ctx.bumps.pda_account;
        msg!("PDA account created successfully");
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64)->Result<()>{
        require!(amount>0, StakeError::InvalidAmount);
        let pda_account = &mut ctx.accounts.pda_account;
        let clock = Clock::get()?;
        update_points(pda_account, clock.unix_timestamp)?;
        
        let cpi_context = CpiContext::new(
            ctx.acounts.system_program.to_account_info(),
            system_program::Transfer{
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.pda_account.to_account_info();
            }
        );
        system_program::transfer(cpi_context, amount)?;

        pda_account.staked_amount = pda_account.staked_amount.checked_add(amount).ok_or(StakeError::Overflow)?;
        msg!("Staked {} lamports. Total staked: {}, Total points: {}", 
             amount, pda_account.staked_amount, pda_account.total_points / 1_000_000);
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64)->Result<()>{
        require!(amount>0, StakeError::InvalidAmount);
        let pda_account = &mut ctx.accounts.pda_account;
        let clock = Clock::get()?;
        require(pda_account.staked_amount>=amount, StakeError::InsufficientStake);
        update_points(pda_account, clock.unix_timestamp)?;

        //transfer sol from pda back to user very important
        let seeds = &[
            b"client1",
            ctx.accounts.user.key().as_ref(),
            &[pda_account.bump]
        ]
        let signer = &[&[seeds[..]]] //program id will sign the pda right, y aren't we putting it?
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer{
                from:ctx.accounts.pda_account.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer,
        );
        system_program::transfer(cpi_context, amount);

        pda_account.staked_amount = pda_account.staked_amount.checked_sub(amount)
            .ok_or(StakeError::Underflow)?;
        
        msg!("Unstaked {} lamports. Remaining staked: {}, Total points: {}", 
             amount, pda_account.staked_amount, pda_account.total_points / 1_000_000);

        Ok(())
    }

    pub fn get_points(ctx: Context<GetPoints>) -> Result<()> {
        let pda_account = &ctx.accounts.pda_account;
        let clock = Clock::get()?;
        
        let time_elapsed = clock.unix_timestamp.checked_sub(pda_account.last_update_time)
            .ok_or(StakeError::InvalidTimestamp)? as u64;
        
        let new_points = calculate_points_earned(pda_account.staked_amount, time_elapsed)?;
        let current_total_points = pda_account.total_points.checked_add(new_points)
            .ok_or(StakeError::Overflow)?;
        
        msg!("Current points: {}, Staked amount: {} SOL", 
             current_total_points / 1_000_000, 
             pda_account.staked_amount / LAMPORTS_PER_SOL);
        
        Ok(())
    }
}

fn unpdate_points(pda_accounts: &mut StakeAccount, current_time: i64)->Result<()>{
    let tiem_elapsed = current_time.checked_sub(pda_account.last_update_time).ok_or(StakeError::InvalidTimestamp)? as u64;
    if tiem_elapsed>0 && pda_account.staked_amount>0{
        let new_points = calculate_points_earned(pda_account.staked_amount, tme_elapsed)?;
        pda_account.total_points = pda_account.total_points.checked_add(new_points).ok_or(StakeError::Overflow)?;
    }
    pda_account.last_update_time = current_time;
    Ok(())
}

fn calculate_points_earned(staked_amount: u64, time_elapsed_seconds: u64)->Result<u64>{
    let points = (staked_amount as u128)
        .checked_mul(time_elapsed_seconds as u128)
        .ok_or(StakeError::Overflow)?
        .checked_mul(POINTS_PER_SOL_PER_DAY as u128)
        .ok_or(StakeError::Overflow)?
        .checked_div(LAMPORTS_PER_SOL as u128)
        .ok_or(StakeError::Overflow)?
        .checked_div(SECONDS_PER_DAY as u128)
        .ok_or(StakeError::Overflow)?;
    
    Ok(points as u64)
}

#[derive(Accounts)]
pub struct CreatePdaAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 8+ 8+8+1, //discriminator + owner public key + stacked_amount + total_points + last_update_time + bump
        seeds = [b"client1", payer.key().as_ref()],
        bump
    )]
    pub pda_account: Account<'info, StakeAccount>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct Stake<'info>{
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"client1", user.key().as_ref()],
        bump = pda_account.bump,
        constraint = pda_account.owner == user.key() @ StakeError::Unauthorized,
    )]
    pub pda_account: Account<'info, StakeAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info>{
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"client1", user.key().as_ref()],
        bump = pda_account.bump, // from where is it getting the pda account?
        constraint = pda_account.owner = user.key() @ StakeError::Unauthorized
    )]
    pub pda_account: Account<'info, StakeAccount>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)]
pub struct ClaimPoints<'info>{
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"client1", user.key().as_ref()],
        bump = pda_account.bump,
        constraint = pda_account.owner == user.key() @StakeError: Unauthorized,
    )]
    pub pda_account: Account<'info, StakeAccount>
}

#[derive(Accounts)]
pub struct GetPoints<'info>{
    pub user: Signer<'info>,

    #[account(
        seeds = [b"client", user.key().as_ref()],
        bump = pda_account.bump,
        constraint = pda_account.owner = user.key() @StakeError::Unauthorized
    )]
    pub pda_account: Account<'info, StakeAccount>
}

#[account]
pub struct StakeAccount{
    pub owner:Pubkey,
    pub staked_amount: u64,
    pub total_points: u64,
    pub last_update_time: i64,
    pub bump: u8
}

#[error_code]
pub enum StakeError{
    #[msg("Amount must be greater than 0")]
    InvalidAmount,
    #[msg("Insufficient staked amount")]
    InsufficientStake,
    #[msg("Unuathorized access")]
    Unauthorized,
    #[msg("Arithemetic underflow")]
    Underflow,
    #[msg("Arithemetic overflow")]
    Overflow,
    #[msg("Invalid timestamp")]
    InvalidTimestamp
}