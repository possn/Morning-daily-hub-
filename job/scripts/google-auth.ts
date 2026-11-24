// Corre UMA vez, no teu computador, para obter o GOOGLE_REFRESH_TOKEN.
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google-auth
// Abre o link, aceita, e copia o refresh token para os secrets do GitHub.
// O token só aparece no teu terminal; não o coles em chats.
import { createServer } from "node:http";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Define GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (cliente OAuth do tipo 'Desktop app').");
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/callback`;
const scopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  if (url.pathname !== "/callback") return void res.end();
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("Sem código. Tenta outra vez.");
    return;
  }
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  }).then((r) => r.json() as Promise<{ refresh_token?: string; error?: string }>);
  res.end(tok.refresh_token ? "Feito. Volta ao terminal." : `Erro: ${tok.error}`);
  console.log(tok.refresh_token ? `\nGOOGLE_REFRESH_TOKEN=${tok.refresh_token}\n` : tok);
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Abre este link no browser e autoriza:\n\n" + authUrl + "\n");
});
