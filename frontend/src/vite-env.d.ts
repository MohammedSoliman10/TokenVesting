/// <reference types="vite/client" />

/** Environment variables documented in frontend/.env.example (research R12). */
interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_CHAIN_ID?: string;
}
