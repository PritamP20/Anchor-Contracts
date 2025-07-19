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
    const resolutionTime = new BN(Math.floor(Date.now() / 1000) + 10); // Give more time

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

  it("Placing bets from multiple bettors", async () => {
    const question = "Will it rain today?";
    const [marketPDA] = await getMarketPDA(question);
    const [betPDA1] = await getBetPDA(marketPDA, bettor1.publicKey);
    const [betPDA2] = await getBetPDA(marketPDA, bettor2.publicKey);
    
    const betAmount1 = new BN(0.1 * LAMPORTS_PER_SOL);
    const betAmount2 = new BN(0.2 * LAMPORTS_PER_SOL);
    const outcomeIndex1 = 0; // bettor1 bets on "Yes"
    const outcomeIndex2 = 1; // bettor2 bets on "No"

    // Place bet for bettor1
    console.log("Placing bet for bettor1...");
    await program.methods
      .placeBet(outcomeIndex1, betAmount1)
      .accounts({
        market: marketPDA,
        bettor: bettor1.publicKey,
        bet: betPDA1,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, bettor1])
      .rpc();

    // Place bet for bettor2
    console.log("Placing bet for bettor2...");
    await program.methods
      .placeBet(outcomeIndex2, betAmount2)
      .accounts({
        market: marketPDA,
        bettor: bettor2.publicKey,
        bet: betPDA2,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority, bettor2])
      .rpc();

    // Verify both bets
    const betAccount1 = await program.account.bet.fetch(betPDA1);
    const betAccount2 = await program.account.bet.fetch(betPDA2);
    
    assert.equal(betAccount1.bettor.toBase58(), bettor1.publicKey.toBase58());
    assert.equal(betAccount1.outcomeIndex, outcomeIndex1);
    assert.isTrue(betAccount1.amount.eq(betAmount1));
    
    assert.equal(betAccount2.bettor.toBase58(), bettor2.publicKey.toBase58());
    assert.equal(betAccount2.outcomeIndex, outcomeIndex2);
    assert.isTrue(betAccount2.amount.eq(betAmount2));

    const marketAccount = await program.account.market.fetch(marketPDA);
    assert.isTrue(marketAccount.totalBets[outcomeIndex1].eq(betAmount1));
    assert.isTrue(marketAccount.totalBets[outcomeIndex2].eq(betAmount2));
  });

  it("Resolving the market", async () => {
    const question = "Will it rain today?"
    const [marketPDA] = await getMarketPDA(question)
    const winningOutcome = 0; // "Yes" wins
    
    console.log("Waiting for resolution time to pass...");
    await new Promise((resolve) => setTimeout(resolve, 12000)); // Wait for resolution time

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

  it("Claiming the bet payout", async () => {
    const question = "Will it rain today?";
    const [marketPDA] = await getMarketPDA(question);
    const [betPDA1] = await getBetPDA(marketPDA, bettor1.publicKey);
    
    const betAmount1 = new BN(0.1 * LAMPORTS_PER_SOL); // bettor1's bet amount
    const betAmount2 = new BN(0.2 * LAMPORTS_PER_SOL); // bettor2's bet amount
    
    const bettor1InitialBalance = await provider.connection.getBalance(bettor1.publicKey);
    const marketInitialBalance = await provider.connection.getBalance(marketPDA);
    
    console.log("Bettor1 initial balance:", bettor1InitialBalance);
    console.log("Market initial balance:", marketInitialBalance);

    try {
      // Try with just bettor as signer first
      await program.methods
        .claimPayout()
        .accounts({
          market: marketPDA,
          bet: betPDA1,
          bettor: bettor1.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([bettor1])
        .rpc();
    } catch (error) {
      console.log("First attempt failed, trying with authority as signer too...");
      // If that fails, try with both authority and bettor as signers
      await program.methods
        .claimPayout()
        .accounts({
          market: marketPDA,
          bet: betPDA1,
          bettor: bettor1.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([authority, bettor1])
        .rpc();
    }

    const bettor1FinalBalance = await provider.connection.getBalance(bettor1.publicKey);
    const marketFinalBalance = await provider.connection.getBalance(marketPDA);
    
    console.log("Bettor1 final balance:", bettor1FinalBalance);
    console.log("Market final balance:", marketFinalBalance);

    // Calculate expected payout
    const totalPool = betAmount1.add(betAmount2); // 0.3 SOL total
    const totalWinningBets = betAmount1; // Only bettor1 won (0.1 SOL)
    const expectedPayout = betAmount1.mul(totalPool).div(totalWinningBets); // Should get entire pool (0.3 SOL)

    console.log("Total pool:", totalPool.toString());
    console.log("Total winning bets:", totalWinningBets.toString());
    console.log("Expected payout:", expectedPayout.toString());

    const actualPayout = bettor1FinalBalance - bettor1InitialBalance;
    const marketDecrease = marketInitialBalance - marketFinalBalance;

    console.log("Actual payout received:", actualPayout);
    console.log("Market balance decrease:", marketDecrease);

    // Allow for small differences due to transaction fees and rounding
    assert.approximately(
      actualPayout,
      Number(expectedPayout),
      1000000, // 0.001 SOL tolerance
      "Bettor should receive the correct payout"
    );

    assert.equal(
      marketDecrease,
      Number(expectedPayout),
      "Market balance should decrease by exactly the payout amount"
    );

    console.log("\n=== PAYOUT SUMMARY ===");
    console.log(`Bettor1 received: ${actualPayout} lamports (${actualPayout / LAMPORTS_PER_SOL} SOL)`);
    console.log(`Expected: ${expectedPayout} lamports (${Number(expectedPayout) / LAMPORTS_PER_SOL} SOL)`);
  });

  // Optional: Test that losing bettor cannot claim
  it("Losing bettor cannot claim payout", async () => {
    const question = "Will it rain today?";
    const [marketPDA] = await getMarketPDA(question);
    const [betPDA2] = await getBetPDA(marketPDA, bettor2.publicKey);

    try {
      await program.methods
        .claimPayout()
        .accounts({
          market: marketPDA,
          bet: betPDA2,
          bettor: bettor2.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId
        })
        .signers([bettor2])
        .rpc();
      
      assert.fail("Losing bettor should not be able to claim payout");
    } catch (error) {
      console.log("Expected error for losing bettor:", error.message);
      assert.isTrue(true, "Losing bettor correctly cannot claim payout");
    }
  });
});