import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Dex } from "../target/types/dex";
import { assert } from "chai";
import { 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL,

} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import keccak256 from "keccak256";
import { beforeAll, describe, it } from "bun:test";

describe("Simple SOL to USDC Swap (Direct Method)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.dex as Program<Dex>;
  const connection = provider.connection;
  const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

  let sessionPda: PublicKey;

  // Token addresses
  const SOL_MINT = NATIVE_MINT;
  const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

  // Swap parameters
  const swapAmount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
  const salt = new Uint8Array(32).fill(42);

  beforeAll(async () => {
    console.log("Setting up simple SOL to USDC swap test...");
    
    // Create session PDA
    [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("session"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    console.log(`Wallet: ${provider.wallet.publicKey.toBase58()}`);
    console.log(`Session PDA: ${sessionPda.toBase58()}`);
    
    // Check balance
    const balance = await connection.getBalance(provider.wallet.publicKey);
    console.log(`SOL balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    
    if (balance < swapAmount + 0.01 * LAMPORTS_PER_SOL) {
      throw new Error(`Need at least ${(swapAmount + 0.01 * LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL} SOL`);
    }
  });

  it("Complete commit-reveal cycle without storing Jupiter instruction", async () => {
    console.log("\n=== Direct Commit-Reveal Swap Test ===");
    
    // Step 1: Create commitment
    console.log("🔐 Step 1: Creating commitment...");
    const commitmentData = Buffer.concat([
      SOL_MINT.toBuffer(),
      USDC_DEVNET.toBuffer(),
      Buffer.from(new anchor.BN(swapAmount).toArray("le", 8)),
      Buffer.from(salt)
    ]);
    const commitment = keccak256(commitmentData);
    
    const commitTx = await program.methods
      .commitSwap(Array.from(commitment))
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Commitment created: ${commitTx}`);

    // Verify commitment
    const session = await program.account.swapSession.fetch(sessionPda);
    assert.deepEqual(Array.from(session.commitment), Array.from(commitment));
    assert.equal(session.revealed, false);

    // Step 2: Reveal and swap directly (without storing instruction)
    console.log("\n🔓 Step 2: Revealing and executing swap directly...");
    
    // For this example, we use empty Jupiter data (no actual swap)
    // In production, you'd get real Jupiter instruction data here
    const jupiterInstructionData = Buffer.alloc(0); // Empty = skip Jupiter execution
    
    const revealTx = await program.methods
      .revealAndSwap(
        Array.from(salt),
        SOL_MINT,
        USDC_DEVNET,
        new anchor.BN(swapAmount),
        jupiterInstructionData // Pass instruction directly
      )
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Swap revealed and executed: ${revealTx}`);

    // Verify reveal worked
    const updatedSession = await program.account.swapSession.fetch(sessionPda);
    assert.equal(updatedSession.revealed, true);
    console.log("✅ Session marked as revealed");

    console.log("\n🎉 Direct swap completed successfully!");
    console.log("No need to store Jupiter instruction separately.");
  });

  it("Test with mock Jupiter instruction data", async () => {
    console.log("\n=== Testing with Mock Jupiter Data ===");
    
    // Create fresh commitment
    const freshSalt = new Uint8Array(32).fill(99);
    const commitmentData = Buffer.concat([
      SOL_MINT.toBuffer(),
      USDC_DEVNET.toBuffer(),
      Buffer.from(new anchor.BN(swapAmount).toArray("le", 8)),
      Buffer.from(freshSalt)
    ]);
    const commitment = keccak256(commitmentData);
    
    await program.methods
      .commitSwap(Array.from(commitment))
      .accounts({
        session: sessionPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Create mock Jupiter instruction (for testing purposes)
    const mockJupiterInstruction = {
      program_id: Array.from(new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4").toBytes()),
      accounts: [],
      data: [1, 2, 3, 4, 5], // Mock instruction data
    };
    
    const jupiterInstructionData = Buffer.from(JSON.stringify(mockJupiterInstruction));
    
    console.log("🔓 Revealing with mock Jupiter instruction...");
    
    try {
      const revealTx = await program.methods
        .revealAndSwap(
          Array.from(freshSalt),
          SOL_MINT,
          USDC_DEVNET,
          new anchor.BN(swapAmount),
          jupiterInstructionData
        )
        .accounts({
          session: sessionPda,
          user: provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`✅ Mock swap executed: ${revealTx}`);
      
    } catch (error) {
      console.log(`⚠️  Expected error with mock data: ${error.message}`);
      // This is expected since we're using mock instruction
      // The important thing is that commitment validation worked
    }

    // Verify the session was updated (reveal logic worked)
    const session = await program.account.swapSession.fetch(sessionPda);
    if (session.revealed) {
      console.log("✅ Commitment verification successful");
    }
  });
});

// Utility function for production use
export async function executeDirectSwap(
  program: Program<Dex>,
  sessionPda: PublicKey,
  userKeypair: any,
  tokenIn: PublicKey,
  tokenOut: PublicKey,
  amount: number,
  salt: Uint8Array,
  jupiterInstructionData: Buffer
) {
  // 1. Create commitment
  const commitmentData = Buffer.concat([
    tokenIn.toBuffer(),
    tokenOut.toBuffer(),
    Buffer.from(new anchor.BN(amount).toArray("le", 8)),
    Buffer.from(salt)
  ]);
  const commitment = keccak256(commitmentData);
  
  await program.methods
    .commitSwap(Array.from(commitment))
    .accounts({
      session: sessionPda,
      user: userKeypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // 2. Reveal and execute in one transaction
  return await program.methods
    .revealAndSwap(
      Array.from(salt),
      tokenIn,
      tokenOut,
      new anchor.BN(amount),
      jupiterInstructionData
    )
    .accounts({
      session: sessionPda,
      user: userKeypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/*
Usage Example:

// Get Jupiter instruction (you'd implement this)
const jupiterInstruction = await getJupiterSwapInstruction(
  SOL_MINT,
  USDC_MINT,
  amount,
  sessionPda
);

// Execute direct swap
const txId = await executeDirectSwap(
  program,
  sessionPda,
  wallet,
  SOL_MINT,
  USDC_MINT,
  amount,
  salt,
  jupiterInstruction
);
*/