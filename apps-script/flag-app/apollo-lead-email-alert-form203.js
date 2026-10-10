const SHEET_NAME_FORM203 = 'Form203';

function sendTestEmailForLastRow_Form203() {
  PropertiesService.getScriptProperties().deleteProperty('lastEmailedRow_Form203');
  processForm203Row_();
}

function processForm203Row_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_FORM203);
  if (!sheet) {
    Logger.log('No tab named "' + SHEET_NAME_FORM203 + '" found.');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('Form203: only the header row exists — no leads to send yet.');
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const propKey = 'lastEmailedRow_Form203';
  const lastEmailedRow = Number(props.getProperty(propKey) || 0);
  if (lastRow <= lastEmailedRow) {
    return;
  }
  props.setProperty(propKey, String(lastRow));

  const numCols = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  const values = sheet.getRange(lastRow, 1, 1, numCols).getValues()[0];

  const matched = matchFields_(headers, values);
  const fullNameField = matched.find(function (f) { return f.label === 'Full Name'; });
  const leadName = fullNameField ? fullNameField.displayValue : 'New lead';

  const subject = 'New Apollo Music Academy lead: ' + leadName;
  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();

  GmailApp.sendEmail(NOTIFY_EMAIL, subject, buildPlainTextBody_(matched, sheetUrl), {
    htmlBody: buildHtmlBody_(matched, sheetUrl),
  });
  Logger.log('Sent lead alert email to ' + NOTIFY_EMAIL + ' for Form203 row ' + lastRow);
}
