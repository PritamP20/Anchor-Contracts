import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PredictionMarket } from "../target/types/prediction_market";
import { publicKey } from "@coral-xyz/anchor/dist/cjs/utils";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BN } from "bn.js";
import { assert } from "chai";

describe("prediction-market", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.predictionMarket as Program<PredictionMarket>;

  const authority = anchor.web3.Keypair.generate();
  const bettor1 = anchor.web3.Keypair.generate();
  const bettor2 = anchor.web3.Keypair.generate();

  const getMarketPDA = async (question: string) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market"), authority.publicKey.toBuffer(), Buffer.from(question)],
      program.programId
    )
  }

  const getBetPDA = async (market: PublicKey, bettor: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), market.toBuffer(), bettor.toBuffer()],
      program.programId
    )
  }

  before(async () => {
    await provider.connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(bettor1.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(bettor2.publicKey, 2 * LAMPORTS_PER_SOL)

    await new Promise((resolve) => setTimeout(resolve, 2000))
  })

  it("Creating a market", async () => {
    const question = "Will it rain today?";
    const outcomes = ["Yes", "No"];
    const resolutionTime = new BN(Math.floor(Date.now() / 1000) + 5);

    const [marketPDA, marketBump] = await getMarketPDA(question);

    const tx = await program.methods
      .createMarket(question, outcomes, resolutionTime)
      .accounts({
        market: marketPDA,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    console.log("Market created with tx:", tx);
    const marketAccount = await program.account.market.fetch(marketPDA);
    assert.equal(marketAccount.authority.toBase58(), authority.publicKey.toBase58(), "Authority should match")
    assert.deepEqual(marketAccount.outcomes, outcomes, "Outcomes should match");
    assert.isTrue(
      marketAccount.resolutionTime.eq(resolutionTime),
      "The resolution time should match"
    );
    assert.isFalse(marketAccount.resolved, "Should be false")
    assert.isTrue(marketAccount.isActive, "Market should be active")
    marketAccount.totalBets.forEach((bet, idx) => {
      assert.isTrue(bet.eq(new BN(0)), `Total bet for outcome ${idx} should be zero`);
    });
  });

  it("Placing a bet", async () => {
    const question = "Will it rain today?";
    const [marketPDA] = await getMarketPDA(question);
    const [betPDA1] = await getBetPDA(marketPDA, bettor1.publicKey);
    const betAmount = new BN(0.1 * LAMPORTS_PER_SOL);
    const outcomeIndex = 0;

    const bettorInitialBalance = await provider.connection.getBalance(bettor1.publicKey);
    const marketInitialBalance = await provider.connection.getBalance(marketPDA);

    console.log("Bet amount:", betAmount.toString());
    console.log("Bettor initial balance:", bettorInitialBalance);
    console.log("Market initial balance:", marketInitialBalance);

    await program.methods
      .placeBet(outcomeIndex, betAmount)
      .accounts({
        market: marketPDA,
        bettor: bettor1.publicKey,
        bet: betPDA1,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, bettor1])
      .rpc();

    const betAccount = await program.account.bet.fetch(betPDA1);
    assert.equal(betAccount.bettor.toBase58(), bettor1.publicKey.toBase58(), "Bettor should match");
    assert.equal(betAccount.outcomeIndex, outcomeIndex, "Outcome index should match");
    assert.isTrue(betAccount.amount.eq(betAmount), "The bet amount should match");

    const marketAccount = await program.account.market.fetch(marketPDA);
    assert.isTrue(marketAccount.totalBets[outcomeIndex].eq(betAmount), "Total bets for the outcome should match");

    const bettor1FinalBalance = await provider.connection.getBalance(bettor1.publicKey);
    const marketFinalBalance = await provider.connection.getBalance(marketPDA);

    console.log("Bettor final balance:", bettor1FinalBalance);
    console.log("Market final balance:", marketFinalBalance);

    const bettorBalanceChange = bettorInitialBalance - bettor1FinalBalance;
    const marketBalanceChange = marketFinalBalance - marketInitialBalance;

    console.log("Bettor balance change:", bettorBalanceChange);
    console.log("Market balance change:", marketBalanceChange);
    
    assert.isTrue(
      bettorBalanceChange > Number(betAmount),
      "Bettor should lose bet amount plus transaction fees"
    );
    
    assert.equal(
      marketBalanceChange,
      Number(betAmount),
      "Market's balance should increase by exactly the bet amount"
    );

    console.log("\n=== SUMMARY ===");
    console.log(`Bettor lost: ${bettorBalanceChange} lamports (${bettorBalanceChange / LAMPORTS_PER_SOL} SOL)`);
    console.log(`Market gained: ${marketBalanceChange} lamports (${marketBalanceChange / LAMPORTS_PER_SOL} SOL)`);
  });

  it("Resolving the market", async () => {
    const question = "Will it rain today?"
    const [marketPDA] = await getMarketPDA(question)
    const winningOutcome = 0;
    console.log("Waiting for resolution time to pass...");
    await new Promise((resolve) => setTimeout(resolve, 6000));

    await program.methods
      .resolveMarket(winningOutcome)
      .accounts({
        market: marketPDA,
        authority: authority.publicKey
      })
      .signers([authority])
      .rpc()

    const marketAccount = await program.account.market.fetch(marketPDA);
    assert.isTrue(marketAccount.resolved, "Market should be resolved");
    assert.isFalse(marketAccount.isActive, "Market should not be active")
    assert.equal(marketAccount.winningOutcome, winningOutcome, "Winning outcome should match")
  })

  it("Claiming the bet", async () => {
    const question = "Will it rain today?";
    const [marketPDA] = await getMarketPDA(question);
    const [betPDA1] = await getBetPDA(marketPDA, bettor1.publicKey);

    const bettorInitialBalance = await provider.connection.getBalance(bettor1.publicKey);
    const marketInitialBalance = await provider.connection.getBalance(marketPDA);

    console.log("Before claiming:");
    console.log("Bettor balance:", bettorInitialBalance);
    console.log("Market balance:", marketInitialBalance);

    await program.methods
      .claimBet()
      .accounts({
        market: marketPDA,
        bettor: bettor1.publicKey,
        bet: betPDA1,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettor1])
      .rpc();

    const bettorFinalBalance = await provider.connection.getBalance(bettor1.publicKey);
    const marketFinalBalance = await provider.connection.getBalance(marketPDA);

    console.log("After claiming:");
    console.log("Bettor balance:", bettorFinalBalance);
    console.log("Market balance:", marketFinalBalance);

    const bettorGain = bettorFinalBalance - bettorInitialBalance;
    const marketLoss = marketInitialBalance - marketFinalBalance;

    console.log("Bettor gained:", bettorGain);
    console.log("Market lost:", marketLoss);
    assert.isTrue(bettorGain > 0, "Winning bettor should gain money");
  })
});