// Weekly backup: every table as a CSV file, bundled into one dated .zip you can open in Excel or Google Sheets.
// Runs entirely in the browser with the signed-in session (the same read access the app already has), so no server
// route or extra permissions are involved. The zip is written without compression, which keeps this dependency-free.

import { loadBackupTable } from './database'

export const BACKUP_TABLES: { table: string; order: string; note: string }[] = [
  { table: 'leads', order: 'id', note: 'Every lead and its status' },
  { table: 'activities', order: 'id', note: 'Calls, texts, emails, notes and status changes' },
  { table: 'instructors', order: 'id', note: 'Instructors and the instruments they teach' },
  { table: 'instructor_availability', order: 'id', note: 'Weekly availability blocks' },
  { table: 'schedule_entries', order: 'id', note: 'Regular, one-time and trial lessons, breaks, vacation' },
  { table: 'trial_openings', order: 'id', note: 'Flagged trial openings' },
  { table: 'schedule_activities', order: 'id', note: 'Schedule change log' },
  { table: 'holds', order: 'id', note: 'Acuity slot holds' },
  { table: 'acuity_events', order: 'id', note: 'Booking events received from Acuity' },
  { table: 'acuity_blocks', order: 'id', note: 'Blocks Apollo created in Acuity' },
  { table: 'acuity_appointment_types', order: 'instrument', note: 'Which Acuity trial lesson belongs to each instrument' },
  { table: 'fee_charges', order: 'id', note: 'Late-cancel / no-show fee records' },
  { table: 'inbound_leads', order: 'id', note: 'Leads received from Meta and the website form' },
  { table: 'outbound_emails', order: 'id', note: 'Day 0 emails drafted or sent' },
  { table: 'esst_hours_entries', order: 'id', note: 'Earned sick and safe time hours (no longer used)' },
  { table: 'esst_usage_entries', order: 'id', note: 'Earned sick and safe time used (no longer used)' },
  { table: 'app_settings', order: 'owner_id', note: 'Settings, message templates, offered instruments' },
]

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const columns: string[] = []
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key)
  if (!columns.length) return '﻿(no rows)\r\n'
  // The leading BOM makes Excel read the file as UTF-8, so names with accents survive.
  return '﻿' + [columns.map(cell).join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\r\n') + '\r\n'
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// Minimal ZIP writer (stored, not compressed; UTF-8 file names).
export function makeZip(files: { name: string; text: string }[], when = new Date()): Blob {
  const encoder = new TextEncoder()
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2)
  const dosDate = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true)
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true)
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.text)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0); u16(lv, 10, dosTime); u16(lv, 12, dosDate)
    u32(lv, 14, crc); u32(lv, 18, data.length); u32(lv, 22, data.length); u16(lv, 26, name.length); u16(lv, 28, 0)
    local.set(name, 30)
    const entry = new Uint8Array(46 + name.length)
    const ev = new DataView(entry.buffer)
    u32(ev, 0, 0x02014b50); u16(ev, 4, 20); u16(ev, 6, 20); u16(ev, 8, 0x0800); u16(ev, 10, 0); u16(ev, 12, dosTime); u16(ev, 14, dosDate)
    u32(ev, 16, crc); u32(ev, 20, data.length); u32(ev, 24, data.length); u16(ev, 28, name.length); u16(ev, 30, 0); u16(ev, 32, 0)
    u16(ev, 34, 0); u16(ev, 36, 0); u32(ev, 38, 0); u32(ev, 42, offset)
    entry.set(name, 46)
    parts.push(local, data)
    central.push(entry)
    offset += local.length + data.length
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0)
  const end = new Uint8Array(22)
  const dv = new DataView(end.buffer)
  u32(dv, 0, 0x06054b50); u16(dv, 4, 0); u16(dv, 6, 0); u16(dv, 8, files.length); u16(dv, 10, files.length)
  u32(dv, 12, centralSize); u32(dv, 16, offset); u16(dv, 20, 0)
  return new Blob([...parts, ...central, end].map((part) => part as BlobPart), { type: 'application/zip' })
}

export const backupFileName = (when = new Date()) => {
  const two = (value: number) => String(value).padStart(2, '0')
  return `apollo-backup-${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}.zip`
}

export interface BackupResult { blob: Blob; fileName: string; counts: { table: string; rows: number; error?: string }[] }

export async function createBackup(onProgress: (message: string) => void): Promise<BackupResult> {
  const files: { name: string; text: string }[] = []
  const counts: BackupResult['counts'] = []
  for (const { table, order } of BACKUP_TABLES) {
    onProgress(`Reading ${table.replace(/_/g, ' ')}…`)
    const { rows, error } = await loadBackupTable(table, order)
    counts.push({ table, rows: rows.length, ...(error ? { error } : {}) })
    if (!error) files.push({ name: `${table}.csv`, text: toCsv(rows) })
  }
  const when = new Date()
  const readme = [
    'Apollo Lead Manager backup',
    `Created ${when.toLocaleString('en-US')}`,
    '',
    'One CSV file per table. Open them in Excel or Google Sheets. Columns that hold lists or structured data are stored as JSON text.',
    'Dates are in UTC (a trailing Z). To restore from these files, ask for help: the files contain everything needed.',
    '',
    ...counts.map((item) => `${item.table}: ${item.error ? `NOT SAVED (${item.error})` : `${item.rows} rows`}`),
  ].join('\r\n')
  files.unshift({ name: 'README.txt', text: readme })
  return { blob: makeZip(files, when), fileName: backupFileName(when), counts }
}

// Opens Chrome's Save dialog with the dated name filled in (it remembers the folder next time); other browsers
// simply download the file to their usual Downloads folder.
export async function saveBackupFile(blob: Blob, fileName: string): Promise<'saved' | 'cancelled'> {
  const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker.call(window, { suggestedName: fileName, id: 'apollo-backups', types: [{ description: 'Backup (zip)', accept: { 'application/zip': ['.zip'] } }] })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'cancelled'
      // any other problem: fall through to a normal download
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'saved'
}
