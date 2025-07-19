use anchor_lang::prelude::*;

declare_id!("2JUq1HtSi9znKbSWwe3b37xTA7V96CcHdLiFmwmmG4DA");

#[program]
pub mod prediction_market {
    use super::*;
    pub fn create_market(
        ctx: Context<CreateMarket>,
        question: String,
        outcomes: Vec<String>,
        resolution_time: i64,
    ) -> Result<()>{
        let market = &mut ctx.accounts.market; //this is poinnting to the new accoutn which was created during the struct instruction phase
        let clock = Clock::get()?;
        require!(outcomes.len() == 2, ErrorCode::InvalidOutcomeCount); // == 
        require!(resolution_time > clock.unix_timestamp, ErrorCode::InvalidResolutionTime);
        require!(question.len() <= 200, ErrorCode::QuestionTooLong); // this might be >= 200

        market.authority = *ctx.accounts.authority.key; // who is providing the ctf
        market.question = question;
        market.outcomes = outcomes;
        market.resolution_time = resolution_time;
        market.resolved = false;
        market.total_bets = vec![0;2]; // didn;t understand this one
        market.is_active = true;

        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, outcome_index: u8, amount: u64)-> Result<()>{
        let market = &mut ctx.accounts.market;
        let bettor = &ctx.accounts.bettor;
        let clock = Clock::get()?;

        require!(market.is_active, ErrorCode::MarketNotActive);
        require!(clock.unix_timestamp < market.resolution_time, ErrorCode::BettingClosed); //error[E0609]: no field `unix_timestamp` on type `std::result::Result<anchor_lang::prelude::Clock, anchor_lang::prelude::ProgramError>`

        require!(outcome_index < market.outcomes.len() as u8, ErrorCode::InvalidOutcome);
        require!(amount>0, ErrorCode::InvalidBetAmount);

        let cpi_accounts = anchor_lang::system_program::Transfer{
            from: ctx.accounts.bettor.to_account_info(),
            to: market.to_account_info(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        anchor_lang::system_program::transfer(cpi_ctx, amount)?;
        let bet = &mut ctx.accounts.bet;
        bet.bettor = *bettor.key; // this is the users key right which is getting seted up during the instruction phase
        bet.outcome_index = outcome_index;
        bet.amount = amount;
        market.total_bets[outcome_index as usize] += amount;
        Ok(())

    }

    pub fn resolve_market(ctx: Context<ResolveMarket>, winning_outcome:u8)-> Result<()>{
        let market = &mut ctx.accounts.market;
        let clock = Clock::get()?;

        require!(market.authority==*ctx.accounts.authority.key, ErrorCode::Unauthorized);
        require!(market.is_active, ErrorCode::MarketNotActive);
        require!(clock.unix_timestamp >= market.resolution_time, ErrorCode::MarketNotReslvable);
        require!(winning_outcome < market.outcomes.len() as u8, ErrorCode::InvalidOutcome); // i didn't understnad this logic, what does he mean
        
        market.resolved = true;
        market.is_active = false;
        market.winning_outcome = Some(winning_outcome); // y are we using some here because winning out_come is not a result enum right then y are we using
        Ok(())
    }

    pub fn claim_payout(ctx: Context<ClaimPayout>)->Result<()>{
        let market = &ctx.accounts.market;
        let bet = &ctx.accounts.bet;
        let bettor = &ctx.accounts.bettor;
        
        require!(market.resolved, ErrorCode::MarketNotResolved);
        require!(market.winning_outcome==Some(bet.outcome_index), ErrorCode::NotWinningBet);
        let total_winning_bets = market.total_bets[bet.outcome_index as usize];
        let total_pool = market.total_bets.iter().sum::<u64>(); //this is summing all the elements of an array
        let payout = if total_winning_bets > 0 {
            (bet.amount as u128 * total_pool as u128 / total_winning_bets as u128) as u64
        }else{
            0 //error
        };
        require!(payout>0, ErrorCode::NoPayout);

        **ctx.accounts.market.to_account_info().try_borrow_mut_lamports()? -= payout; // how is the contract getting authority to transfer the amount 
        **ctx.accounts.bettor.to_account_info().try_borrow_mut_lamports()?+=payout; // so the system program will transfer the amiount or the authority of the market willl transfer the amount

        Ok(())
    }
}

#[derive(Accounts)] // creating a market account like eg ipl teams csk, rcb etc
#[instruction(question:String, outcomes: Vec<String>, resolution_time: i64)] // i didn't understand this
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer=authority,
        space=8 + 32 + 4 + 200 + 4 + 2 * 50 + 8 + 1 + 4 + 2 * 8 + 1 + 8,
        seeds = [b"market", authority.key().as_ref(), question.as_bytes()], //y are we adding this line
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>
}

#[derive(Accounts)] // an accouint which will have the details about which team / market did the user bet on
#[instruction(outcome_index:u8, amount: u64)] // the arguments the user will provide
pub struct PlaceBet<'info>{
    #[account(mut, has_one = authority)] // //authority not in scope so this is checking the market account whether it is from the correct authority or not
    pub market: Account<'info, Market>, // the market account to bet on
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = bettor,
        space = 8+32+1+8,
        seeds = [b"bet", market.key().as_ref(), bettor.key().as_ref()],
        bump
    )] // this macro is used to create a required bet account
    pub bet: Account<'info, Bet>,
    #[account(mut)]
    pub bettor: Signer<'info>, 
    pub system_program: Program<'info, System>,
}


#[derive(Accounts)]
#[instruction(winning_outcome:u8)]
pub struct ResolveMarket<'info> {
    #[account(mut, has_one=authority)]
    pub market: Account<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info>{
    #[account(has_one = authority)] //authority not in scope
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub bet: Account<'info, Bet>,
    #[account(mut)] // Mutable bettor account to receive payout.
    pub bettor: Signer<'info>, // Bettor must sign.
}

#[account]
pub struct Bet{
    pub bettor: Pubkey,
    pub outcome_index: u8,
    pub amount: u64
}

#[account]
pub struct Market{
    pub authority: Pubkey,
    pub question: String,
    pub outcomes: Vec<String>,
    pub resolution_time: i64,
    pub resolved: bool,
    pub winning_outcome: Option<u8> ,// this one is doubt option is given because at the start is None after the resolution time the winner index is decided so we wait until then
    pub total_bets: Vec<u64>,
    pub is_active: bool
}

#[error_code]
pub enum ErrorCode{
    #[msg("Msrket is not active")] MarketNotActive,
    #[msg("Invalid number of outcomes")] InvalidOutcomeCount,
    #[msg("Invalid resolution time")] InvalidResolutionTime,
    #[msg("Question is too long")] QuestionTooLong,
    #[msg("Invalid outcome index")] InvalidOutcome,
    #[msg("Market not resolvable yet")] MarketNotReslvable,
    #[msg("Market not resolved")] MarketNotResolved,
    #[msg("Not as winning bet")] NotWinningBet,
    #[msg("No payout available")] NoPayout,
    #[msg("Unauthorized access")] Unauthorized,
    #[msg("Betting closed")] BettingClosed,
    #[msg("Invalid bet amount")] InvalidBetAmount,
}
