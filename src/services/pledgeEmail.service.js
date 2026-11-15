import { sendMail } from "./sendmail.service.js";
import Pledge, { PLEDGE_STATUS } from "../models/pledge.model.js";
import { RECURRING_RULES } from "../config/recurring.config.js";
import { formatRupeesINR } from "../utils/money.util.js";
import { hmacHex } from "../utils/crypto.util.js";
import { buildPortalUrl } from "./magicLink.service.js";

/**
 * Transactional emails specific to recurring pledges.
 *
 * Deliberately self-contained (the legacy emailTemplate.js renders one-time
 * donation receipts) and always includes a manage/cancel link plus the
 * grievance contact, both of which the RBI e-mandate framework expects the
 * donor to have.
 */

const COLORS = {
    primary: "#1376c8",
    success: "#16a34a",
    danger: "#dc2626",
    text: "#334155",
    light: "#64748b",
    bg: "#f8fafc",
    border: "#e2e8f0",
};

const LOGO =
    "https://res.cloudinary.com/drd5iva1i/image/upload/b_rgb:FFFFFF/v1730919455/b965f91b-321f-4ed6-97f9-1908840d5731.png";

const formatDate = (date) =>
    new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
    }).format(new Date(date));

const wrap = ({ title, intro, bodyHtml, ctaText, ctaUrl, tone = "primary" }) => `
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:${COLORS.bg};padding:24px 12px;color:${COLORS.text};">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid ${COLORS.border};">
    <div style="padding:22px;text-align:center;border-bottom:1px solid ${COLORS.border};">
      <img src="${LOGO}" alt="Satyalok" width="150" style="display:block;margin:0 auto;border:0;" />
    </div>
    <div style="padding:28px 24px;">
      <h1 style="margin:0 0 12px;font-size:20px;color:${tone === "danger" ? COLORS.danger : COLORS.text};">${title}</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">${intro}</p>
      ${bodyHtml}
      ${
          ctaUrl
              ? `<div style="text-align:center;margin:26px 0 8px;">
        <a href="${ctaUrl}" style="display:inline-block;padding:12px 22px;background:${COLORS.primary};color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">${ctaText}</a>
      </div>`
              : ""
      }
      <p style="margin:22px 0 0;font-size:12px;color:${COLORS.light};line-height:1.6;">
        You are receiving this because you set up a monthly donation mandate with Satyalok.
        You can pause, skip or cancel at any time from the link above — no questions asked.
        Questions or disputes: <a href="mailto:${RECURRING_RULES.grievanceEmail}" style="color:${COLORS.primary};">${RECURRING_RULES.grievanceEmail}</a>.
      </p>
    </div>
    <div style="background:${COLORS.bg};padding:16px;text-align:center;font-size:11px;color:${COLORS.light};border-top:1px solid ${COLORS.border};">
      Satyalok — A New Hope · <a href="${RECURRING_RULES.termsUrl}" style="color:${COLORS.light};">Terms</a> ·
      <a href="${RECURRING_RULES.privacyUrl}" style="color:${COLORS.light};">Privacy</a>
    </div>
  </div>
</div>`;

const detailRow = (label, value) => `
<tr>
  <td style="padding:10px 0;border-bottom:1px solid ${COLORS.border};font-size:13px;color:${COLORS.light};">${label}</td>
  <td style="padding:10px 0;border-bottom:1px solid ${COLORS.border};font-size:13px;text-align:right;font-weight:600;">${value}</td>
</tr>`;

const detailTable = (rows) =>
    `<table style="width:100%;border-collapse:collapse;margin:8px 0 4px;">${rows
        .map(([label, value]) => detailRow(label, value))
        .join("")}</table>`;

const portalUrlFor = (pledge) =>
    buildPortalUrl(pledge._id || pledge.id, { path: "" });

const safeSend = async (to, subject, html, logger) => {
    try {
        await sendMail(
            to,
            subject,
            "View this email in an HTML capable client for the full details.",
            html,
        );
    } catch (error) {
        logger?.error?.(`Pledge email failed (${subject}):`, error?.message || error);
    }
};

/** Sent when the mandate is approved and month 1 has been collected. */
const sendPledgeActivated = async ({ pledge, debit, logger = console }) =>
    safeSend(
        pledge.donor.email,
        "Your monthly pledge to Satyalok is active",
        wrap({
            title: "Your monthly pledge is active",
            intro: `Thank you, ${pledge.donor.name}. Your mandate is approved and your first donation of ${formatRupeesINR(
                pledge.amount,
            )} has been received. Satyalok will debit ${formatRupeesINR(
                pledge.amount,
            )} every month until you cancel.`,
            bodyHtml: detailTable([
                ["Pledge reference", pledge.pledgeRef],
                ["Amount", `${formatRupeesINR(pledge.amount)} / month`],
                ["Next debit", formatDate(pledge.nextDebitAt)],
                ["Mandate valid until", formatDate(pledge.expiresAt)],
                ["Paid so far", formatRupeesINR(pledge.totalDonatedPaise / 100)],
            ]),
            ctaText: "Manage my pledge",
            ctaUrl: portalUrlFor(pledge),
        }),
        logger,
    );

/** Sent at least 24 hours before a debit (RBI pre-debit notification). */
const sendPledgeDebitNotice = async ({ pledge, debit, logger = console }) =>
    safeSend(
        pledge.donor.email,
        `Heads up: ${formatRupeesINR(debit.amount)} will be debited on ${formatDate(
            debit.scheduledFor,
        )}`,
        wrap({
            title: "Upcoming monthly donation",
            intro: `As per RBI's e-mandate rules we're letting you know in advance that ${formatRupeesINR(
                debit.amount,
            )} will be debited from your UPI account for your Satyalok pledge.`,
            bodyHtml: detailTable([
                ["Amount", formatRupeesINR(debit.amount)],
                ["Debit date", formatDate(debit.scheduledFor)],
                ["Pledge reference", pledge.pledgeRef],
                ["Cycle", `Month ${debit.cycleNumber}`],
            ]),
            ctaText: "Skip this month or cancel",
            ctaUrl: portalUrlFor(pledge),
        }),
        logger,
    );

/** Sent when a debit fails but retries remain. */
const sendPledgeDebitFailure = async ({ pledge, debit, errorMessage, logger = console }) =>
    safeSend(
        pledge.donor.email,
        "We couldn't collect your monthly donation",
        wrap({
            title: "Your donation could not be debited",
            intro: `The bank declined this month's debit of ${formatRupeesINR(
                debit.amount,
            )}. We'll try again automatically — you don't need to do anything unless you'd like to update your payment method.`,
            bodyHtml: detailTable([
                ["Amount", formatRupeesINR(debit.amount)],
                ["Reason", errorMessage],
                ["Retry scheduled", debit.nextRetryAt ? formatDate(debit.nextRetryAt) : "—"],
                ["Pledge reference", pledge.pledgeRef],
            ]),
            ctaText: "Review my pledge",
            ctaUrl: portalUrlFor(pledge),
            tone: "danger",
        }),
        logger,
    );

/** Sent when all retries for a cycle are exhausted. */
const sendPledgePastDue = async ({ pledge, debit, errorMessage, logger = console }) =>
    safeSend(
        pledge.donor.email,
        "Action needed: your Satyalok pledge is past due",
        wrap({
            title: "We missed this month's donation",
            intro: `We tried ${RECURRING_RULES.maxRetriesPerCycle} times to collect ${formatRupeesINR(
                debit.amount,
            )} but the bank declined each attempt. Your pledge is still saved — updating your UPI mandate or ensuring funds are available will let it resume next month.`,
            bodyHtml: detailTable([
                ["Last attempt", formatDate(debit.scheduledFor)],
                ["Reason", errorMessage],
                ["Next scheduled attempt", formatDate(pledge.nextDebitAt)],
                ["Pledge reference", pledge.pledgeRef],
            ]),
            ctaText: "Update my pledge",
            ctaUrl: portalUrlFor(pledge),
            tone: "danger",
        }),
        logger,
    );

/** Sent when a pledge is cancelled by the donor or an admin. */
const sendPledgeCancelled = async ({ pledge, reason, logger = console }) =>
    safeSend(
        pledge.donor.email,
        "Your Satyalok monthly pledge has been cancelled",
        wrap({
            title: "Your pledge is cancelled",
            intro: `Your monthly pledge of ${formatRupeesINR(
                pledge.amount,
            )} has been stopped. No further debits will be made. Thank you for the ${formatRupeesINR(
                pledge.totalDonatedPaise / 100,
            )} you contributed.`,
            bodyHtml: detailTable([
                ["Pledge reference", pledge.pledgeRef],
                ["Reason", reason || "Cancelled by donor"],
                ["Total donated", formatRupeesINR(pledge.totalDonatedPaise / 100)],
            ]),
            ctaText: "Start a new pledge",
            ctaUrl: `${(process.env.FRONTEND_URL || "https://donate.satyalok.in").replace(/\/$/, "")}/pledge`,
        }),
        logger,
    );

/** Emails a fresh management link to an existing donor. */
const sendPortalLink = async ({ email, logger = console }) => {
    const donorKey = hmacHex(String(email || "").trim().toLowerCase());
    const pledge = await Pledge.findOne({
        "donor.donorKey": donorKey,
        status: {
            $in: [
                PLEDGE_STATUS.ACTIVE,
                PLEDGE_STATUS.PAUSED,
                PLEDGE_STATUS.PAST_DUE,
                PLEDGE_STATUS.PENDING_AUTH,
            ],
        },
    }).sort({ createdAt: -1 });

    // Always resolve quietly: telling a stranger whether an email is on file
    // would turn this endpoint into a donor-lookup oracle.
    if (!pledge) {
        return { sent: false };
    }

    await safeSend(
        pledge.donor.email,
        "Your Satyalok pledge management link",
        wrap({
            title: "Manage your monthly pledge",
            intro: `Here is your secure link, ${pledge.donor.name}. Use it to view your donation history, skip a month, pause or cancel.`,
            bodyHtml: detailTable([
                ["Pledge reference", pledge.pledgeRef],
                ["Amount", `${formatRupeesINR(pledge.amount)} / month`],
                ["Status", pledge.status.replace(/_/g, " ").toLowerCase()],
            ]),
            ctaText: "Open my pledge",
            ctaUrl: portalUrlFor(pledge),
        }),
        logger,
    );

    return { sent: true };
};

export {
    sendPledgeActivated,
    sendPledgeDebitNotice,
    sendPledgeDebitFailure,
    sendPledgePastDue,
    sendPledgeCancelled,
    sendPortalLink,
};

