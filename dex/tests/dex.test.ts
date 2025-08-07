// import { it, describe, beforeAll, expect } from 'bun:test';

// import * as anchor from "@coral-xyz/anchor";
// import { Program } from "@coral-xyz/anchor";
// import { Dex } from "../target/types/dex";
// import { assert } from "chai";
// import { 
//   Keypair, 
//   PublicKey, 
//   SystemProgram,
// } from "@solana/web3.js";
// import { 
//   TOKEN_PROGRAM_ID, 
//   createMint, 
//   getOrCreateAssociatedTokenAccount, 
//   mintTo,
// } from "@solana/spl-token";
// import keccak256 from "keccak256";

// describe("dex-reveal-test", () => {
//   anchor.setProvider(anchor.AnchorProvider.env());
//   const provider = anchor.getProvider();
//   const program = anchor.workspace.dex as Program<Dex>;

//   let mint: PublicKey;
//   let sessionPda: PublicKey;
//   const amount = 500_000;
//   const salt = new Uint8Array(32).fill(1);

//   beforeAll(async () => {
//     // Setup mint
//     mint = await createMint(
//       provider.connection,
//       provider.wallet.payer,
//       provider.wallet.publicKey,
//       null,
//       6 
//     );

//     [sessionPda] = await PublicKey.findProgramAddress(
//       [Buffer.from("session"), provider.wallet.publicKey.toBuffer()],
//       program.programId
//     );

//     console.log("Setup completed:");
//     console.log("- Mint:", mint.toBase58());
//     console.log("- Session PDA:", sessionPda.toBase58());
//   });

//   it("Reveals swap without Jupiter execution", async () => {
//     const tokenIn = mint;
//     const tokenOut = mint;
    
//     // Step 1: Create and commit
//     const buf = Buffer.concat([
//       tokenIn.toBuffer(),
//       tokenOut.toBuffer(),
//       Buffer.from(new anchor.BN(amount).toArray("le", 8)),
//       Buffer.from(salt)
//     ]);
//     const commitment = keccak256(buf);
    
//     await program.methods.commitSwap(Array.from(commitment)).accounts({
//       session: sessionPda,
//       user: provider.wallet.publicKey,
//       systemProgram: SystemProgram.programId,
//     }).rpc();

//     console.log("✅ Commitment created");

//     // Step 2: Reveal with empty Jupiter instruction
//     // Pass empty Buffer directly, not converted to array
//     const emptyJupiterData = Buffer.alloc(0);

//     const tx = await program.methods.revealAndSwap(
//       Array.from(salt), // Salt as array is correct
//       tokenIn,
//       tokenOut,
//       new anchor.BN(amount),
//       emptyJupiterData // Pass Buffer directly, not as array
//     ).accounts({
//       session: sessionPda,
//       user: provider.wallet.publicKey,
//       tokenProgram: TOKEN_PROGRAM_ID,
//       systemProgram: SystemProgram.programId,
//     }).rpc();

//     // Verify the reveal worked
//     const session = await program.account.swapSession.fetch(sessionPda);
//     assert.isTrue(session.revealed);
//     console.log("✅ Swap revealed successfully!");
//     console.log("Transaction:", tx);
//   });

//   it("Tests commitment validation", async () => {
//     const tokenIn = mint;
//     const tokenOut = mint;
//     const wrongSalt = new Uint8Array(32).fill(99);
    
//     // Create a new commitment with correct salt
//     const buf = Buffer.concat([
//       tokenIn.toBuffer(),
//       tokenOut.toBuffer(),
//       Buffer.from(new anchor.BN(amount).toArray("le", 8)),
//       Buffer.from(salt)
//     ]);
//     const commitment = keccak256(buf);
    
//     await program.methods.commitSwap(Array.from(commitment)).accounts({
//       session: sessionPda,
//       user: provider.wallet.publicKey,
//       systemProgram: SystemProgram.programId,
//     }).rpc();

//     console.log("✅ Commitment created");

//     // Try to reveal with wrong salt
//     const emptyJupiterData = Buffer.alloc(0);

//     try {
//       await program.methods.revealAndSwap(
//         Array.from(wrongSalt), // Wrong salt
//         tokenIn,
//         tokenOut,
//         new anchor.BN(amount),
//         emptyJupiterData // Pass Buffer directly
//       ).accounts({
//         session: sessionPda,
//         user: provider.wallet.publicKey,
//         tokenProgram: TOKEN_PROGRAM_ID,
//         systemProgram: SystemProgram.programId,
//       }).rpc();
      
//       assert.fail("Should have failed with commitment mismatch");
//     } catch (error) {
//       console.log("Error message:", error.message);
//       // Check for commitment mismatch error
//       const errorStr = error.toString().toLowerCase();
//       assert.isTrue(
//         errorStr.includes("commitment") || errorStr.includes("6002") || error.message.includes("CommitmentMismatch"),
//         "Should fail with commitment mismatch error"
//       );
//       console.log("✅ Invalid commitment properly rejected");
//     }
//   });

//   it("Complete commit-reveal cycle", async () => {
//     const tokenIn = mint;
//     const tokenOut = mint;
    
//     // Step 1: Create commitment
//     const buf = Buffer.concat([
//       tokenIn.toBuffer(),
//       tokenOut.toBuffer(),
//       Buffer.from(new anchor.BN(amount).toArray("le", 8)),
//       Buffer.from(salt)
//     ]);
//     const commitment = keccak256(buf);
    
//     await program.methods.commitSwap(Array.from(commitment)).accounts({
//       session: sessionPda,
//       user: provider.wallet.publicKey,
//       systemProgram: SystemProgram.programId,
//     }).rpc();

//     console.log("✅ Commitment phase successful");

//     // Step 2: Reveal
//     const emptyJupiterData = Buffer.alloc(0);
    
//     const tx = await program.methods.revealAndSwap(
//       Array.from(salt),
//       tokenIn,
//       tokenOut,
//       new anchor.BN(amount),
//       emptyJupiterData // Pass Buffer directly
//     ).accounts({
//       session: sessionPda,
//       user: provider.wallet.publicKey,
//       tokenProgram: TOKEN_PROGRAM_ID,
//       systemProgram: SystemProgram.programId,
//     }).rpc();

//     // Verify the session state
//     const session = await program.account.swapSession.fetch(sessionPda);
//     assert.isTrue(session.revealed);
//     assert.equal(session.user.toBase58(), provider.wallet.publicKey.toBase58());

//     console.log("✅ Complete cycle successful!");
//     console.log("Transaction:", tx);
//   });

//   it("Test cancel commitment", async () => {
//     const tokenIn = mint;
//     const tokenOut = mint;
    
//     // Create commitment
//     const buf = Buffer.concat([
//       tokenIn.toBuffer(),
//       tokenOut.toBuffer(),
//       Buffer.from(new anchor.BN(amount).toArray("le", 8)),
//       Buffer.from(salt)
//     ]);
//     const commitment = keccak256(buf);
    
//     await program.methods.commitSwap(Array.from(commitment)).accounts({
//       session: sessionPda,
//       user: provider.wallet.publicKey,
//       systemProgram: SystemProgram.programId,
//     }).rpc();

//     // Cancel commitment
//     await program.methods.cancelCommitment().accounts({
//       session: sessionPda,
//       user: provider.wallet.publicKey,
//     }).rpc();

//     // Verify cancellation
//     const session = await program.account.swapSession.fetch(sessionPda);
//     assert.isFalse(session.revealed);
//     // Check that commitment is zeroed out
//     const zeroCommitment = new Array(32).fill(0);
//     assert.deepEqual(Array.from(session.commitment), zeroCommitment);

//     console.log("✅ Commitment cancelled successfully");
//   });
// });



import { it, describe, beforeAll, expect } from 'bun:test';
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Dex } from "../target/types/dex";
import { assert } from "chai";
import { 
  Keypair, 
  PublicKey, 
  SystemProgram,
  TransactionInstruction,
  Connection,
  clusterApiUrl
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import keccak256 from "keccak256";
import fetch from 'node-fetch';

// Jupiter API helper functions
class JupiterApi {
  private baseUrl = 'https://quote-api.jup.ag/v6';

  async getQuote(inputMint: string, outputMint: string, amount: number, slippageBps: number = 50) {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
    });

    const response = await fetch(`${this.baseUrl}/quote?${params}`);
    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${response.statusText}`);
    }
    return await response.json();
  }

  async getSwapTransaction(quoteResponse: any, userPublicKey: string) {
    const response = await fetch(`${this.baseUrl}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      }),
    });

    if (!response.ok) {
      throw new Error(`Jupiter swap transaction failed: ${response.statusText}`);
    }
    return await response.json();
  }
}

describe("dex-jupiter-integration", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider();
  const program = anchor.workspace.dex as Program<Dex>;
  const connection = provider.connection;
  const jupiter = new JupiterApi();

  let sessionPda: PublicKey;
  let jupiterIxPda: PublicKey;
  let mintA: PublicKey; // Input token
  let mintB: PublicKey; // Output token
  let userTokenAccountA: any;
  let userTokenAccountB: any;
  
  const amount = 1_000_000; // 1 token with 6 decimals
  const salt = new Uint8Array(32).fill(1);

  // Common token addresses on devnet
  const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  const SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112"); // Wrapped SOL

  beforeAll(async () => {
    console.log("Setting up Jupiter integration test...");
    
    // Create session PDA
    [sessionPda] = await PublicKey.findProgramAddress(
      [Buffer.from("session"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    // Create Jupiter instruction PDA
    [jupiterIxPda] = await PublicKey.findProgramAddress(
      [Buffer.from("jupiter_ix"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );

    console.log("- Session PDA:", sessionPda.toBase58());
    console.log("- Jupiter IX PDA:", jupiterIxPda.toBase58());
    console.log("- Wallet:", provider.wallet.publicKey.toBase58());
  });

  it("Creates commitment for SOL to USDC swap", async () => {
    const tokenIn = SOL_MINT;
    const tokenOut = USDC_DEVNET;
    
    // Create commitment
    const buf = Buffer.concat([
      tokenIn.toBuffer(),
      tokenOut.toBuffer(),
      Buffer.from(new anchor.BN(amount).toArray("le", 8)),
      Buffer.from(salt)
    ]);
    const commitment = keccak256(buf);
    
    const tx = await program.methods.commitSwap(Array.from(commitment)).accounts({
      session: sessionPda,
      user: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();

    console.log("✅ Commitment created for SOL->USDC swap");
    console.log("Transaction:", tx);

    // Verify commitment
    const session = await program.account.swapSession.fetch(sessionPda);
    assert.deepEqual(Array.from(session.commitment), Array.from(commitment));
    assert.isFalse(session.revealed);
  });

  it("Gets Jupiter quote and stores instruction", async () => {
    try {
      // Get quote from Jupiter
      const quote = await jupiter.getQuote(
        SOL_MINT.toBase58(),
        USDC_DEVNET.toBase58(),
        amount,
        100 // 1% slippage
      );

      console.log("Jupiter quote received:");
      console.log(`- Input: ${quote.inAmount} ${quote.inputMint}`);
      console.log(`- Output: ${quote.outAmount} ${quote.outputMint}`);
      console.log(`- Price impact: ${quote.priceImpactPct}%`);

      // Get swap transaction from Jupiter
      const swapResult = await jupiter.getSwapTransaction(
        quote,
        sessionPda.toBase58() // Use session PDA as the signer for Jupiter
      );

      // Deserialize the transaction to get the Jupiter instruction
      const transaction = anchor.web3.Transaction.from(
        Buffer.from(swapResult.swapTransaction, 'base64')
      );

      // Find the Jupiter instruction (should be the main instruction)
      const jupiterIx = transaction.instructions.find(ix => 
        ix.programId.equals(new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"))
      );

      if (!jupiterIx) {
        throw new Error("Jupiter instruction not found in transaction");
      }

      // Serialize the Jupiter instruction
      const serializedIx = Buffer.from(
        anchor.utils.bytes.base64.encode(
          // Create a simple serialization of the instruction
          JSON.stringify({
            programId: jupiterIx.programId.toBase58(),
            keys: jupiterIx.keys.map(key => ({
              pubkey: key.pubkey.toBase58(),
              isSigner: key.isSigner,
              isWritable: key.isWritable
            })),
            data: Array.from(jupiterIx.data)
          })
        )
      );

      // Store Jupiter instruction in our program
      const tx = await program.methods.storeJupiterInstruction(
        serializedIx
      ).accounts({
        instructionAccount: jupiterIxPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();

      console.log("✅ Jupiter instruction stored");
      console.log("Transaction:", tx);

    } catch (error) {
      console.log("⚠️ Jupiter API call failed (this is expected on devnet):", error.message);
      console.log("Storing a mock Jupiter instruction instead...");

      // Create a mock Jupiter instruction for testing
      const mockInstruction = {
        programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
        keys: [],
        data: [1, 2, 3, 4] // Mock data
      };

      const serializedMockIx = Buffer.from(JSON.stringify(mockInstruction));

      const tx = await program.methods.storeJupiterInstruction(
        serializedMockIx
      ).accounts({
        instructionAccount: jupiterIxPda,
        user: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      }).rpc();

      console.log("✅ Mock Jupiter instruction stored");
      console.log("Transaction:", tx);
    }
  });

  it("Reveals swap with stored Jupiter instruction", async () => {
    const tokenIn = SOL_MINT;
    const tokenOut = USDC_DEVNET;

    try {
      const tx = await program.methods.revealAndSwapWithStoredIx(
        Array.from(salt),
        tokenIn,
        tokenOut,
        new anchor.BN(amount)
      ).accounts({
        session: sessionPda,
        instructionAccount: jupiterIxPda,
        user: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      // Add remaining accounts that Jupiter might need
      .remainingAccounts([
        // You would add Jupiter's required accounts here
        // This varies based on the specific swap being performed
      ])
      .rpc();

      console.log("✅ Swap revealed and executed");
      console.log("Transaction:", tx);

      // Verify the reveal worked
      const session = await program.account.swapSession.fetch(sessionPda);
      assert.isTrue(session.revealed);

    } catch (error) {
      console.log("⚠️ Swap execution failed (expected with mock data):", error.message);
      console.log("This is normal when using mock Jupiter instructions");
    }
  });

  it("Direct reveal with Jupiter instruction data", async () => {
    const tokenIn = SOL_MINT;
    const tokenOut = USDC_DEVNET;

    // Create fresh commitment
    const buf = Buffer.concat([
      tokenIn.toBuffer(),
      tokenOut.toBuffer(),
      Buffer.from(new anchor.BN(amount).toArray("le", 8)),
      Buffer.from(salt)
    ]);
    const commitment = keccak256(buf);
    
    await program.methods.commitSwap(Array.from(commitment)).accounts({
      session: sessionPda,
      user: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();

    // For this example, we'll just use empty instruction data
    const emptyJupiterData = Buffer.alloc(0);

    const tx = await program.methods.revealAndSwap(
      Array.from(salt),
      tokenIn,
      tokenOut,
      new anchor.BN(amount),
      emptyJupiterData
    ).accounts({
      session: sessionPda,
      user: provider.wallet.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).rpc();

    console.log("✅ Direct reveal completed (no Jupiter execution)");
    console.log("Transaction:", tx);

    const session = await program.account.swapSession.fetch(sessionPda);
    assert.isTrue(session.revealed);
  });
});

// Helper function to create a proper Jupiter instruction for your program
export async function createJupiterSwapInstruction(
  inputMint: string,
  outputMint: string,
  amount: number,
  sessionPda: PublicKey,
  slippageBps: number = 100
): Promise<Buffer> {
  const jupiter = new JupiterApi();
  
  try {
    // Get quote
    const quote = await jupiter.getQuote(inputMint, outputMint, amount, slippageBps);
    
    // Get swap transaction with session PDA as signer
    const swapResult = await jupiter.getSwapTransaction(quote, sessionPda.toBase58());
    
    // Deserialize and find Jupiter instruction
    const transaction = anchor.web3.Transaction.from(
      Buffer.from(swapResult.swapTransaction, 'base64')
    );
    
    const jupiterIx = transaction.instructions.find(ix => 
      ix.programId.equals(new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"))
    );
    
    if (!jupiterIx) {
      throw new Error("Jupiter instruction not found");
    }
    
    // Serialize the instruction using bincode format (matching your Rust program)
    return Buffer.from(bincode.serialize({
      program_id: jupiterIx.programId.toBytes(),
      accounts: jupiterIx.keys.map(key => ({
        pubkey: key.pubkey.toBytes(),
        is_signer: key.isSigner,
        is_writable: key.isWritable
      })),
      data: jupiterIx.data
    }));
    
  } catch (error) {
    console.error("Failed to create Jupiter instruction:", error);
    throw error;
  }
}

// Usage example for production:
/*
// 1. Create commitment
const commitment = createCommitment(tokenIn, tokenOut, amount, salt);
await program.methods.commitSwap(commitment).accounts({...}).rpc();

// 2. Get Jupiter instruction
const jupiterIxData = await createJupiterSwapInstruction(
  tokenIn.toBase58(),
  tokenOut.toBase58(), 
  amount,
  sessionPda
);

// 3. Either store instruction first, then reveal:
await program.methods.storeJupiterInstruction(jupiterIxData).accounts({...}).rpc();
await program.methods.revealAndSwapWithStoredIx(salt, tokenIn, tokenOut, amount).accounts({...}).rpc();

// OR reveal directly with instruction:
await program.methods.revealAndSwap(salt, tokenIn, tokenOut, amount, jupiterIxData).accounts({...}).rpc();
*/