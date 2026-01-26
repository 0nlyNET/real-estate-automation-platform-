import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>RealtyTechAI</title>
        <meta name="description" content="Real estate automation for modern agents" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
