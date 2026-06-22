function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type LoginPageParams = {
  clientName: string;
  redirectUri: string;
  /** Signed, tamper-evident copy of the parsed OAuth request. */
  oauthToken: string;
  csrf: string;
  error?: string;
};

/**
 * Renders the TrainHeroic login + consent page. The user enters their TrainHeroic
 * credentials (coach or athlete), which the server validates and stores in the grant's
 * encrypted props. The page names the requesting client and its redirect URI (consent), and
 * carries a CSRF token plus the signed OAuth request.
 */
export function renderLoginPage(params: LoginPageParams): string {
  const { clientName, redirectUri, oauthToken, csrf, error } = params;
  const errorBlock = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect to TrainHeroic</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 26rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.25rem; }
  .client { background: rgba(127,127,127,0.12); border-radius: 8px; padding: 0.75rem 1rem; margin: 1rem 0; font-size: 0.9rem; }
  label { display: block; margin: 0.75rem 0 0.25rem; font-weight: 600; font-size: 0.9rem; }
  input[type=email], input[type=password] { width: 100%; padding: 0.6rem; border-radius: 6px; border: 1px solid rgba(127,127,127,0.5); box-sizing: border-box; }
  button { margin-top: 1.25rem; width: 100%; padding: 0.7rem; border: 0; border-radius: 6px; background: #2563eb; color: #fff; font-size: 1rem; cursor: pointer; }
  .error { color: #b91c1c; background: rgba(185,28,28,0.1); padding: 0.6rem 0.8rem; border-radius: 6px; font-size: 0.9rem; }
  .muted { color: rgba(127,127,127,0.9); font-size: 0.8rem; }
</style>
</head>
<body>
  <h1>Connect TrainHeroic</h1>
  <div class="client">
    <strong>${escapeHtml(clientName)}</strong> is requesting access to your TrainHeroic
    account and will be able to act on your behalf.
    <div class="muted">Redirect: ${escapeHtml(redirectUri)}</div>
  </div>
  ${errorBlock}
  <form method="post" action="/authorize" autocomplete="on">
    <label for="email">TrainHeroic email</label>
    <input id="email" name="email" type="email" required autocomplete="username" />
    <label for="password">TrainHeroic password</label>
    <input id="password" name="password" type="password" required autocomplete="current-password" />
    <input type="hidden" name="csrf" value="${escapeHtml(csrf)}" />
    <input type="hidden" name="oauth_req" value="${escapeHtml(oauthToken)}" />
    <button type="submit">Sign in and authorize</button>
  </form>
  <p class="muted">Your credentials are sent only to TrainHeroic and stored encrypted to
  keep your session active. They are never shared with the connecting app.</p>
</body>
</html>`;
}
