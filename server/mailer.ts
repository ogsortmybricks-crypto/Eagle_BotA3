import nodemailer from "nodemailer";
import { env, emailConfigured } from "./env";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!emailConfigured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      // 465 is implicit TLS; 587 upgrades via STARTTLS.
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  }
  return transporter;
}

export type MailResult = { sent: boolean; error?: string };

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<MailResult> {
  const tx = getTransporter();
  if (!tx) {
    return {
      sent: false,
      error: "Email isn't configured. Add SMTP_USER and SMTP_PASS (a Google App Password) to the environment.",
    };
  }
  try {
    await tx.sendMail({
      from: env.smtp.from || env.smtp.user,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[mail] send failed", message);
    return { sent: false, error: message };
  }
}

function shell(academyName: string, accent: string, body: string) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:700;margin-bottom:20px">${escapeHtml(academyName)}</div>
    ${body}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
    <div style="font-size:12px;color:#6b7280">Sent by Eagle Bot, the governance record for ${escapeHtml(academyName)}.</div>
  </div></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function inviteEmail(opts: {
  academyName: string;
  accent: string;
  inviterName: string;
  role: string;
  link: string;
}) {
  const html = shell(
    opts.academyName,
    opts.accent,
    `<h1 style="font-size:22px;margin:0 0 12px">You've been invited</h1>
     <p style="font-size:15px;line-height:1.6;margin:0 0 8px">${escapeHtml(opts.inviterName)} invited you to join <strong>${escapeHtml(opts.academyName)}</strong> on Eagle Bot as a <strong>${escapeHtml(opts.role)}</strong>.</p>
     <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#4b5563">Eagle Bot keeps the studio's rules, Town Hall decisions, and elections in one place that's always current.</p>
     <a href="${opts.link}" style="display:inline-block;background:${opts.accent};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px">Set up your account</a>
     <p style="font-size:13px;color:#6b7280;margin:20px 0 0">Or paste this link into your browser:<br><span style="word-break:break-all">${opts.link}</span></p>
     <p style="font-size:13px;color:#6b7280;margin:12px 0 0">This invite expires in 14 days.</p>`,
  );
  const text = `${opts.inviterName} invited you to join ${opts.academyName} on Eagle Bot as a ${opts.role}.\n\nSet up your account: ${opts.link}\n\nThis invite expires in 14 days.`;
  return { html, text, subject: `Join ${opts.academyName} on Eagle Bot` };
}

export function electionOpenEmail(opts: {
  academyName: string;
  accent: string;
  title: string;
  closesAt: string | null;
  link: string;
}) {
  const html = shell(
    opts.academyName,
    opts.accent,
    `<h1 style="font-size:22px;margin:0 0 12px">A vote is open</h1>
     <p style="font-size:15px;line-height:1.6;margin:0 0 8px"><strong>${escapeHtml(opts.title)}</strong> is open for voting.</p>
     ${opts.closesAt ? `<p style="font-size:15px;color:#4b5563;margin:0 0 24px">Voting closes ${escapeHtml(opts.closesAt)}.</p>` : '<div style="height:16px"></div>'}
     <a href="${opts.link}" style="display:inline-block;background:${opts.accent};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px">Cast your vote</a>`,
  );
  const text = `${opts.title} is open for voting${opts.closesAt ? ` until ${opts.closesAt}` : ""}.\n\nVote here: ${opts.link}`;
  return { html, text, subject: `Vote open: ${opts.title}` };
}
