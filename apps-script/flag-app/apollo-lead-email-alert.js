/**
 * Apollo Music Academy — New Lead Email Alert
 * =============================================
 * Lives inside the "Apollo Music Academy - Lead Ads" Google Sheet (the same
 * sheet Meta's Lead Ads integration writes new leads into). Watches for new
 * rows and emails a designed notification the moment a new lead comes in.
 *
 * WHY "onChange" AND NOT "onEdit" / "onFormSubmit":
 *   Meta writes new lead rows into this sheet via a server-side API push,
 *   not by a person typing into a cell (onEdit) or a Google Form (onForm
 *   Submit). An installable "onChange" trigger is the one that reliably
 *   fires for that kind of API-driven row insert.
 *
 * ---------------------------------------------------------------
 * ONE-TIME SETUP (do this once, in the actual Google Sheet):
 *   1. Open the "Apollo Music Academy - Lead Ads" spreadsheet.
 *   2. Extensions > Apps Script.
 *   3. Delete any placeholder code in the editor, then paste in this
 *      entire file. Save (Ctrl/Cmd+S, or the disk icon).
 *   4. In the toolbar, pick "createTrigger" from the function dropdown
 *      (next to the Run button), then click Run.
 *   5. The FIRST time you run anything here, Google will pop up
 *      "Authorization required" -> click "Review permissions", pick your
 *      account, click "Advanced" if it warns you, then "Go to
 *      (project name)", then "Allow". This step has to be done by you
 *      personally — it's your Google account granting the script
 *      permission to send email and read the sheet as you.
 *   6. Done. From now on, every new lead row triggers an email to
 *      NOTIFY_EMAIL below, automatically, with no further action needed.
 *
 * TO CHANGE WHO GETS THE ALERTS, OR WHICH SHEET TAB IS WATCHED:
 *   Just edit the two constants right below, then Save. No need to
 *   re-run createTrigger unless you're setting this up for the first
 *   time on a fresh copy of the sheet.
 *
 * TO CHANGE WHICH FIELDS SHOW UP IN THE EMAIL, OR THEIR ORDER:
 *   Edit the FIELDS_TO_INCLUDE list below. Each entry is a set of
 *   keywords matched case-insensitively against the sheet's header row —
 *   the first header containing any of the keywords is used, so the
 *   exact wording of the lead form's question doesn't have to be typed
 *   out here. Whatever text is actually in that header cell is shown as
 *   the label in the email.
 *
 * TO SEND YOURSELF A TEST EMAIL RIGHT NOW (without waiting for a real
 * lead): pick "sendTestEmailForLastRow" from the function dropdown and
 * click Run. It emails you the most recent row already in the sheet.
 * ---------------------------------------------------------------
 */

// ==================== CONFIG — edit freely ====================
const NOTIFY_EMAIL = 'cstoebner@apollo-music.com'; // where new-lead alerts go
const SHEET_NAME = 'Sheet1'; // the tab Meta delivers leads into

// Fields to show in the email, in this order. `label` is the friendly name
// shown in the email. `keywords` are matched whole-word (not raw substring —
// so "age" won't match inside "messages") against the sheet's header row;
// the first header containing any of them is used for that row.
const FIELDS_TO_INCLUDE = [
  { label: 'Phone Number', keywords: ['phone'] },
  { label: 'Full Name', keywords: ['full name', 'full_name'] },
  { label: 'Email', keywords: ['email'] },
  { label: 'Student Age', keywords: ['age'] },
  { label: 'SMS Consent', keywords: ['sms', 'text message'] },
  { label: 'Instrument', keywords: ['instrument'] },
  { label: 'Can Travel to Chaska', keywords: ['travel'] },
  { label: 'Submitted', keywords: ['created'] },
];
// ================================================================

/**
 * Run this ONCE, manually, from the Apps Script editor to install the
 * trigger that watches for new leads. Safe to re-run — it clears out any
 * duplicate trigger first.
 */
function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onLeadChange') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('onLeadChange')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onChange()
    .create();

  Logger.log('Trigger installed. New leads will now email ' + NOTIFY_EMAIL);
}

/**
 * Fires automatically whenever the sheet changes (installable onChange
 * trigger). Figures out whether a new lead row actually showed up, and if
 * so, emails NOTIFY_EMAIL with that lead's answers.
 */
function onLeadChange(e) {
  // onChange fires for lots of things (formatting tweaks, row deletes,
  // column resizes...) not just new rows. Meta's API-driven inserts
  // typically report as INSERT_ROW or OTHER, so only act on those —
  // and don't bail if e is missing (that happens when this function is
  // run manually instead of by the trigger, e.g. while testing).
  if (e && e.changeType !== 'INSERT_ROW' && e.changeType !== 'OTHER') {
    return;
  }
  processLatestRow_();
    processForm203Row_();
    processForm204Row_();
    processForm205Row_();

  // Also hand the new row(s) to the Apollo app (see apollo-intake.js). Guarded so a problem there can never
  // stop the alert emails above, and it does nothing until APOLLO_INTAKE_SECRET is set.
  try {
    apolloOnSheetChange();
  } catch (error) {
    Logger.log('Apollo intake failed: ' + error);
  }
}

/**
 * Manual test helper — run this directly from the Apps Script editor any
 * time to immediately email yourself the most recent row in the sheet,
 * without needing a real (or test) lead to come in first.
 */
function sendTestEmailForLastRow() {
  // Force it to (re-)send even if this row was already emailed before.
  PropertiesService.getScriptProperties().deleteProperty('lastEmailedRow');
  processLatestRow_();
}

/**
 * Shared logic: look at the last row of the sheet and, if it's new (or
 * we're being asked to resend via sendTestEmailForLastRow), email it.
 */
function processLatestRow_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log('No tab named "' + SHEET_NAME + '" found — check SHEET_NAME at the top of the script.');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('Only the header row exists — no leads to send yet.');
    return; // nothing but the header row
  }

  // Skip if we've already emailed this exact row (onChange can fire more
  // than once for what is really the same single insert).
  const props = PropertiesService.getScriptProperties();
  const lastEmailedRow = Number(props.getProperty('lastEmailedRow') || 0);
  if (lastRow <= lastEmailedRow) {
    return;
  }
  props.setProperty('lastEmailedRow', String(lastRow));

  const numCols = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  const values = sheet.getRange(lastRow, 1, 1, numCols).getValues()[0];

  const matched = matchFields_(headers, values);
  if (matched.length === 0) {
    Logger.log('None of the configured FIELDS_TO_INCLUDE keywords matched any header — check the header row and FIELDS_TO_INCLUDE.');
  }

  const fullNameField = matched.find(function (f) {
    return f.label === 'Full Name';
  });
  const leadName = fullNameField ? fullNameField.displayValue : 'New lead';

  const subject = 'New Apollo Music Academy lead: ' + leadName;
  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();

  GmailApp.sendEmail(NOTIFY_EMAIL, subject, buildPlainTextBody_(matched, sheetUrl), {
    htmlBody: buildHtmlBody_(matched, sheetUrl),
  });
  Logger.log('Sent lead alert email to ' + NOTIFY_EMAIL + ' for row ' + lastRow);
}

/**
 * Walks FIELDS_TO_INCLUDE in order and finds the first matching, not-yet-used,
 * non-blank header for each. Returns an array of {label, displayValue,
 * keywords} for whichever fields were actually found.
 *
 * Matching is whole-word, not raw substring — e.g. the keyword "age" matches
 * "what_is_the_age_of_the_student" but NOT "sms_text_messages" (which
 * contains "age" only as part of the word "messages"). Headers are
 * underscore/punctuation-normalized to space-separated words first, then
 * padded with spaces so a keyword search is a boundary-safe substring check.
 */
function matchFields_(headers, values) {
  const usedIndices = {};
  const matched = [];
  const normalizedHeaders = headers.map(normalizeForMatch_);

  FIELDS_TO_INCLUDE.forEach(function (field) {
    const keywordPatterns = field.keywords.map(normalizeForMatch_);

    for (let i = 0; i < headers.length; i++) {
      if (usedIndices[i]) continue;
      const isMatch = keywordPatterns.some(function (kw) {
        return normalizedHeaders[i].indexOf(kw) !== -1;
      });
      if (!isMatch) continue;

      const rawValue = values[i];
      // A match with a blank value isn't the field we want — keep scanning
      // in case a later header also matches (this is what previously broke
      // "Full Name": ad_name/campaign_name/etc. also contain "name" and are
      // blank on a test-form lead, so bailing out here missed full_name).
      if (rawValue === '' || rawValue === null || rawValue === undefined) continue;

      usedIndices[i] = true;
      matched.push({
        label: field.label,
        displayValue: formatValue_(field, rawValue),
        keywords: field.keywords,
      });
      break;
    }
  });

  return matched;
}

/** Lowercases, collapses any run of non-alphanumeric characters to a single
 * space, and pads with a leading/trailing space so word-boundary substring
 * checks (`normalized.indexOf(' age ') !== -1`) can't match mid-word. */
function normalizeForMatch_(text) {
  return ' ' + String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

/**
 * Formats a cell value for display — special-cases the "created" timestamp,
 * and otherwise replaces underscores with spaces (Meta's answer values for
 * button/choice questions come through as raw slugs, e.g. "yes,_that's_fine").
 */
function formatValue_(field, rawValue) {
  const isCreatedField = field.keywords.indexOf('created') !== -1;
  if (isCreatedField) {
    const date = rawValue instanceof Date ? rawValue : new Date(rawValue);
    if (isNaN(date.getTime())) return String(rawValue);
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMM d, yyyy h:mm a');
  }

  return String(rawValue).replace(/_/g, ' ');
}

function buildPlainTextBody_(matched, sheetUrl) {
  const lines = matched.map(function (f) {
    return f.label + ': ' + f.displayValue;
  });
  return lines.join('\n') + '\n\nFull sheet: ' + sheetUrl;
}

function buildHtmlBody_(matched, sheetUrl) {
  const rows = matched
    .map(function (f) {
      return (
        '<tr>' +
        '<td style="padding:10px 16px;border-bottom:1px solid #eee;color:#6b6b6b;font-size:13px;white-space:nowrap;vertical-align:top;">' +
        escapeHtml_(f.label) +
        '</td>' +
        '<td style="padding:10px 16px;border-bottom:1px solid #eee;color:#1a1a1a;font-size:14px;font-weight:600;">' +
        escapeHtml_(f.displayValue) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  return (
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;">' +
    '<div style="background:#2d3fe0;border-radius:12px 12px 0 0;padding:20px 24px;">' +
    '<span style="color:#ffffff;font-size:18px;font-weight:700;">New Apollo Music Academy Lead</span>' +
    '</div>' +
    '<div style="border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;overflow:hidden;">' +
    '<table style="width:100%;border-collapse:collapse;">' +
    rows +
    '</table>' +
    '<div style="padding:14px 16px;background:#fafafa;">' +
    '<a href="' + sheetUrl + '" style="color:#2d3fe0;font-size:13px;text-decoration:none;">View full sheet →</a>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
