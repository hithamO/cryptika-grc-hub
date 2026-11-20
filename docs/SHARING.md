# Sharing Cryptika GRC Hub

Sharing never copies the data. Other people open the system that runs on one computer (the *host*), sign in with
their own name and password, and see only what their account allows. The database stays in `data/grc.db` on the host.

## Before you share

1. **Give each person their own account.**
   - Someone who should see every organisation (a manager at Cryptika): *Platform → Platform team → Add person*.
   - Someone who should see one organisation only: open that workspace, then *Workspace → People → Add person* and choose a role.
2. **Change the first-run passwords.** Sign in on the host as `admin@cryptika.local`, open the menu under your name and
   choose *Change password*. Accounts that still use the first-run password are refused for anyone who is not at the host.
3. **Send the link and the password separately** (for example the link by email and the password by phone).

## Three ways to share

| | How | Use it for |
|---|---|---|
| **Office network** | Double-click `share.bat`, choose **1**. Give people `http://<address shown>:4000`. | Colleagues on the same network or VPN. Traffic is not encrypted, so use it only on a network you trust. |
| **Secure link** | Double-click `share.bat`, choose **2**. A link such as `https://some-words.trycloudflare.com` appears. | A quick review or demonstration from anywhere. The link is encrypted, works while the window is open and changes on every start. |
| **Company server** | Install on a server or cloud machine behind your HTTPS reverse proxy, with `HOST=127.0.0.1` and `GRC_COOKIE_SECURE=1`. | Daily use by clients. A fixed address, your own certificate, backups and monitoring. |

The secure link uses Cloudflare's free quick tunnel: `share.bat` downloads the tunnel client once into `tools/`, and Cloudflare
relays the encrypted traffic to this computer. Cloudflare states that quick tunnels are for testing and come with no uptime
guarantee; move to the company server option before clients rely on the system.

## What protects the data while it is shared

- Every request needs a signed-in session; sessions end after 12 hours or when the person signs out.
- Each organisation's records are separated in every query; a person can never open another organisation's data.
- Eight wrong passwords from one address lock that account's sign-in from that address for 15 minutes.
- First-run passwords work only on the host computer.
- Through the secure link the session cookie is marked `Secure` and `HttpOnly`.
- The platform team can make an organisation read-only, suspend it for a set time, or sign everyone out at once
  (*Platform → Organisations → Manage access*).

## Client data

An imported client workspace holds real assessment data: server addresses and open vulnerabilities.
Check the client agreement before anyone outside the engagement team is given access, prefer the office network or the
company server for it, and give reviewers a role that only reads.

## Stop sharing

Close the `share.bat` window. The link stops working at once and nothing stays online.
