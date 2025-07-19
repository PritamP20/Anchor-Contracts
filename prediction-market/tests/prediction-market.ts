import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PredictionMarket } from "../target/types/prediction_market";
import { publicKey } from "@coral-xyz/anchor/dist/cjs/utils";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BN } from "bn.js";
import { assert } from "chai";

describe("prediction-market", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.predictionMarket as Program<PredictionMarket>;

  const authority = anchor.web3.Keypair.generate();
  const bettor1 = anchor.web3.Keypair.generate();
  const bettor2 = anchor.web3.Keypair.generate();

  const getMarketPDA = async (question:string)=>{
    return PublicKey.findProgramAddressSync(
      [Buffer.from("market"), authority.publicKey.toBuffer(), Buffer.from(question)],
      program.programId
    )
  }

  const getBetPDA = async(market:PublicKey, bettor:PublicKey)=>{
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), market.toBuffer(), bettor.toBuffer()],
      program.programId
    )
  }

  before(async()=>{
    await provider.connection.requestAirdrop(authority.publicKey, 2*LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(authority.publicKey, 2*LAMPORTS_PER_SOL);
    await provider.connection.requestAirdrop(authority.publicKey, 2*LAMPORTS_PER_SOL)

    await new Promise((resolve)=> setTimeout(resolve, 2000))
  })

  it("Creating a market", async () => {
    const question = "Will it rain today?";
    const outcomes = ["Yes", "No"];
    const resolutionTime = new BN(Math.floor(Date.now() / 1000) + 3600);

    const [marketPDA, marketBump] = await getMarketPDA(question);

    const tx = await program.methods
      .createMarket(question, outcomes, resolutionTime)
      .accounts({
        market: marketPDA,
        authority: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority]) // only needed if `authority` is not the provider
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


  it("Placing a bet", async()=>{

  })

  it("Resolving the market", async()=>{

  })

  it("Claiming the bet", async()=>{

  })
});
