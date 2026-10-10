/**
 * Apollo Lead Manager — automatic lead intake
 * ===========================================
 * Sends every new lead to the Apollo app and sends the Day 0 emails Apollo queues.
 *
 *   1. META LEADS  — new rows in the Lead Ads sheet are posted to Apollo as they arrive.
 *   2. FORMSPREE   — new "noreply@formspree.io" emails are parsed and posted to Apollo.
 *   3. OUTBOX      — Apollo queues approved Day 0 emails; this script sends them from this Gmail
 *                    account and tells Apollo each one went out.
 *
 * Nothing here decides anything: Apollo creates the lead, checks for duplicates, picks the trial
 * times and writes the email. If Apollo's "Send automatically" setting is off, emails wait for your
 * OK on the Today page, so this script can't send anything you haven't approved.
 *
 * The existing alert emails (apollo-lead-email-alert*.js) are untouched and keep working.
 *
 * ---------------------------------------------------------------
 * ONE-TIME SETUP
 *   1. Project Settings (gear icon) -> Script Properties -> Add property:
 *        Name:  APOLLO_INTAKE_SECRET
 *        Value: (the same secret you saved as INTAKE_SECRET in Cloudflare)
 *      Until this property exists, everything below quietly does nothing.
 *   2. Pick "setupApolloTriggers" in the function dropdown and click Run. Google will ask you to
 *      approve new permissions (reading Gmail, contacting Apollo). That approval is yours to give.
 *   3. To check the Formspree reader without posting anything, run "testFormspreeParse" and
 *      look at the log: it prints the fields found in your latest Formspree email.
 * ---------------------------------------------------------------
 */

// =================== CONFIG ===================
const APOLLO_BASE_URL = 'https://apollo-lead-manager.pages.dev';
// Sheet tabs Meta delivers leads into (the tab name becomes the lead's campaign in Apollo).
const APOLLO_META_TABS = ['Sheet1', 'Form203', 'Apollo Trial Lead Form 204', 'Apollo Trial Lead Form 205'];
const APOLLO_FORMSPREE_SENDER = 'noreply@formspree.io';
const APOLLO_LABEL = 'Apollo-Ingested'; // marks Formspree emails already sent to Apollo
const APOLLO_FROM_NAME = 'Conor at Apollo Music Academy';
// The field names a Formspree email can contain (used to tell a field name from a value).
const FORMSPREE_KEYS = ['requested_instructor', 'source', 'flyer', 'instrument', 'student_type', 'experience', 'name', 'phone', 'student_name', 'email', 'notes'];
// ==============================================

function setupApolloTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'apolloTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('apolloTick').timeBased().everyMinutes(1).create();
  Logger.log('Installed: apolloTick will run every minute (Formspree emails, missed Meta rows, outgoing emails).');
}

/** Runs every minute. Each step is independent so one failing doesn't block the others. */
function apolloTick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // another run is still working
  try {
    [apolloIngestMetaRows_, apolloIngestFormspree_, apolloSendQueuedEmails_].forEach(function (step) {
      try { step(); } catch (error) { Logger.log(step.name + ' failed: ' + error); }
    });
  } finally {
    lock.releaseLock();
  }
}

/** Called from onLeadChange the moment a new sheet row lands, so Meta leads don't wait for the next minute. */
function apolloOnSheetChange() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // apolloTick will pick the row up
  try {
    apolloIngestMetaRows_();
    apolloSendQueuedEmails_();
  } finally {
    lock.releaseLock();
  }
}

// ---------------- shared helpers ----------------

function apolloSecret_() {
  return PropertiesService.getScriptProperties().getProperty('APOLLO_INTAKE_SECRET');
}

/** POSTs JSON to Apollo. Returns {status, body}; never throws on HTTP errors. */
function apolloPost_(path, payload) {
  const response = UrlFetchApp.fetch(APOLLO_BASE_URL + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Intake-Secret': apolloSecret_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  let body = {};
  try { body = JSON.parse(response.getContentText()); } catch (e) { body = { raw: response.getContentText().slice(0, 200) }; }
  return { status: response.getResponseCode(), body: body };
}

// ---------------- 1. Meta rows ----------------

/**
 * Posts every sheet row added since the last run. The first run on a tab just remembers where the sheet
 * ends, so existing leads are never re-sent. A row that Apollo can't take right now (network, outage) is
 * retried on the next run, in order, until it goes through.
 */
function apolloIngestMetaRows_() {
  if (!apolloSecret_()) return;
  const props = PropertiesService.getScriptProperties();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  APOLLO_META_TABS.forEach(function (tabName) {
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    const key = 'apollo_lastRow_' + tabName;
    const stored = props.getProperty(key);
    if (stored === null) { props.setProperty(key, String(lastRow)); return; } // first run: start from now
    let done = Number(stored);
    if (lastRow <= done) return;

    const numCols = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
    for (let row = done + 1; row <= lastRow; row++) {
      const values = sheet.getRange(row, 1, 1, numCols).getValues()[0];
      const fields = { __form: tabName };
      headers.forEach(function (header, i) {
        const value = values[i];
        if (value === '' || value === null || value === undefined) return;
        fields[String(header)] = value instanceof Date ? value.toISOString() : String(value);
      });
      const idField = fields.id || fields.Id || fields.ID || (tabName + ':row' + row);
      const created = headerValue_(fields, 'created');
      const result = apolloPost_('/api/inbound/lead', {
        source: 'meta',
        externalId: 'meta:' + idField,
        receivedAt: created || undefined,
        fields: fields,
      });
      if (result.status !== 200) {
        Logger.log('Apollo rejected ' + tabName + ' row ' + row + ' (' + result.status + '): ' + JSON.stringify(result.body));
        break; // retry this row next run, keeping the order
      }
      done = row;
      props.setProperty(key, String(done));
    }
  });
}

function headerValue_(fields, word) {
  const keys = Object.keys(fields);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase().indexOf(word) !== -1) return fields[keys[i]];
  }
  return '';
}

// ---------------- 2. Formspree emails ----------------

function apolloIngestFormspree_() {
  if (!apolloSecret_()) return;
  const label = GmailApp.getUserLabelByName(APOLLO_LABEL) || GmailApp.createLabel(APOLLO_LABEL);
  const threads = GmailApp.search('from:' + APOLLO_FORMSPREE_SENDER + ' -label:' + APOLLO_LABEL + ' newer_than:2d', 0, 20);

  threads.forEach(function (thread) {
    let allDone = true;
    thread.getMessages().forEach(function (message) {
      if (message.getFrom().toLowerCase().indexOf(APOLLO_FORMSPREE_SENDER) === -1) return;
      const fields = parseFormspreeBody_(message.getPlainBody());
      if (!fields.email && message.getReplyTo()) fields.email = extractAddress_(message.getReplyTo());
      const result = apolloPost_('/api/inbound/lead', {
        source: 'formspree',
        externalId: 'formspree:' + message.getId(),
        receivedAt: message.getDate().toISOString(),
        fields: fields,
      });
      if (result.status !== 200) {
        Logger.log('Apollo rejected a Formspree email (' + result.status + '): ' + JSON.stringify(result.body));
        allDone = false;
      }
    });
    if (allDone) thread.addLabel(label);
  });
}

function extractAddress_(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : String(value)).trim();
}

/**
 * Formspree lists each field as a name line followed by its value line(s); an empty field is just a name
 * with nothing under it. Known field names mark where each value starts.
 */
function parseFormspreeBody_(plainBody) {
  const fields = {};
  let current = null;
  String(plainBody).split(/\r?\n/).forEach(function (rawLine) {
    const line = rawLine.trim();
    if (/^(Submitted\b|You are receiving this|Don't want these emails)/i.test(line)) { current = null; return; }
    if (FORMSPREE_KEYS.indexOf(line) !== -1) { current = line; if (!(line in fields)) fields[line] = ''; return; }
    // Also accept "name: value" on a single line, in case Formspree's plain-text layout differs from its HTML one.
    const inline = line.match(/^([a-z_]+)\s*[:=]\s*(.*)$/);
    if (inline && FORMSPREE_KEYS.indexOf(inline[1]) !== -1) { current = inline[1]; fields[current] = inline[2]; return; }
    if (current && line) fields[current] = fields[current] ? fields[current] + ' ' + line : line;
  });
  Object.keys(fields).forEach(function (key) { if (fields[key] === '') delete fields[key]; });
  return fields;
}

/** Run this by hand to see what the reader finds in your newest Formspree email. Posts nothing. */
function testFormspreeParse() {
  const threads = GmailApp.search('from:' + APOLLO_FORMSPREE_SENDER, 0, 1);
  if (!threads.length) { Logger.log('No Formspree emails found.'); return; }
  const messages = threads[0].getMessages();
  const message = messages[messages.length - 1];
  Logger.log('Subject: ' + message.getSubject());
  Logger.log('Reply-To: ' + message.getReplyTo());
  Logger.log('Fields found: ' + JSON.stringify(parseFormspreeBody_(message.getPlainBody()), null, 2));
}

// ---------------- 3. Outgoing emails ----------------

/**
 * Sends the emails Apollo has queued. Every send is remembered locally, so if telling Apollo "sent" fails
 * (or Apollo hands the same email out again after a crash) it is reported but never sent a second time.
 */
function apolloSendQueuedEmails_() {
  if (!apolloSecret_()) return;
  const props = PropertiesService.getScriptProperties();
  const sentIds = JSON.parse(props.getProperty('apollo_sentIds') || '[]');

  const pulled = apolloPost_('/api/inbound/outbox', { action: 'pull' });
  if (pulled.status !== 200) { Logger.log('Could not reach Apollo outbox (' + pulled.status + ').'); return; }

  (pulled.body.emails || []).forEach(function (email) {
    if (sentIds.indexOf(email.id) === -1) {
      try {
        GmailApp.sendEmail(email.to, email.subject, email.text, { htmlBody: email.html, name: APOLLO_FROM_NAME });
        sentIds.push(email.id);
        props.setProperty('apollo_sentIds', JSON.stringify(sentIds.slice(-100)));
      } catch (error) {
        apolloPost_('/api/inbound/outbox', { action: 'failed', id: email.id, error: String(error) });
        return;
      }
    }
    apolloPost_('/api/inbound/outbox', { action: 'sent', id: email.id });
  });
}
