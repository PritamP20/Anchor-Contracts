use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("9oXxjbYe4sCXMDynm3W88NhKPQR2MqpKSjkuNisV8Dbt");

#[program]
pub mod cpi_contracts {
    use super::*;

    pub fn sol_transfer(ctx: Context<SolTransfer>, amount: u64) -> Result<()> {
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
        );

        transfer(cpi_context, amount)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct SolTransfer<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(mut)]
    pub recipient: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}
