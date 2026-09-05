# Browser-session login

SWITCH edu-ID stays in Chrome. The MCP server never receives the password.

Closing Chrome drops the SWITCH session. Leave the login window open.

Chrome is started with an ephemeral local debug port written into the profile (`DevToolsActivePort`). There is no well-known port `9333`.

## Working sequence

1. Stop extra ADAM processes: Inspector, stray `npm run start:browser` terminals, extra Chrome profile windows.
2. From the repo root:

```bash
npm run login
```

3. Sign in with SWITCH edu-ID in that Chrome window. When the dashboard appears, **leave the terminal and Chrome running**.
4. In Cursor: Settings → MCP → enable **adam**. Reload MCP if it was already listed.
5. In chat, use `adam_session_status` then `adam_list_courses`.

Do not paste the password into the terminal or into chat.

`npm run start:browser` is only the MCP stdio server. Running it in a normal terminal looks “stuck” and does not attach to Cursor.
