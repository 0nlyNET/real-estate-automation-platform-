import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect } from "react";
import { initTheme } from "../lib/theme";
import "../styles/globals.css";

export default function MyApp({ Component, pageProps }: AppProps) {
  useEffect(() => {
    initTheme();
  }, []);

  return (
    <>
      <Head>
        <title>RealtyTechAI</title>
        <meta name="description" content="Real estate automation for modern agents" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
