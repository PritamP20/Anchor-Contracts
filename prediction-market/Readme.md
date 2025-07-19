# Solana Prediction Market (Anchor)

A smart contract built using Solana and the Anchor framework that allows users to create prediction markets, place bets on different outcomes, and claim winnings based on the result. The contract manages user funds securely using PDAs and token accounts.

---

## Features

- Create prediction markets with multiple outcomes
- Users can bet on any outcome
- Market creators can resolve the outcome
- Winning users can claim rewards

---

## Devnet Deployment

- Cluster: https://api.devnet.solana.com  
- Program ID: 2JUq1HtSi9znKbSWwe3b37xTA7V96CcHdLiFmwmmG4DA  
- Deploy Signature: [3nDJ7ei5jB6AuJUTDM6FiTAYEJZ6CWXUqj1aZyCXGa8yNSBFFpC6o5RQwsc35zgC2w2V3XnoixnaRiwuTyqt5NZ2](https://explorer.solana.com/tx/3nDJ7ei5jB6AuJUTDM6FiTAYEJZ6CWXUqj1aZyCXGa8yNSBFFpC6o5RQwsc35zgC2w2V3XnoixnaRiwuTyqt5NZ2?cluster=devnet)

---

## Tech Stack

- Solana
- Anchor framework
- TypeScript (for test scripts)
- SPL Token Program

---

## Project Structure

```bash
prediction-market/
├── programs/
│ └── prediction_market/ # Rust contract code
├── tests/
│ └── prediction-market.ts # Test file
├── target/deploy/
│ └── prediction_market.so # Compiled binary
└── Anchor.toml # Anchor configuration
```


---

## Commands

Build the contract:

```bash
anchor build
anchor test
anchor deploy --provider.cluster devnet
```