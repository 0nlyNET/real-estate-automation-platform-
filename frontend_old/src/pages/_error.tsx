import type { NextPageContext } from "next";

type Props = { statusCode?: number };

function ErrorPage({ statusCode }: Props) {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
      <p style={{ color: "#444" }}>
        {statusCode
          ? `Server returned an error (${statusCode}).`
          : "An unexpected client error occurred."}
      </p>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404;
  return { statusCode };
};

export default ErrorPage;

