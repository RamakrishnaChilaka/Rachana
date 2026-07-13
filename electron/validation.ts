import path from 'node:path'
import { z } from 'zod'

export const absolutePathSchema = z.string().min(1).max(32_768).refine(
  (candidate) => path.isAbsolute(candidate) && !candidate.includes('\0'),
  'An absolute filesystem path is required'
)

export const nameSchema = z.string().trim().min(1).max(255)

export const saveFileSchema = z.object({
  filePath: absolutePathSchema,
  content: z.string(),
  expectedHash: z.string().min(1).optional(),
  expectedIdentity: z.string().min(1).optional(),
}).strict()

export const saveFileAsSchema = z.object({
  filePath: absolutePathSchema,
  content: z.string(),
  openPaths: z.array(absolutePathSchema),
  sourcePath: absolutePathSchema,
  isRecovery: z.boolean(),
  forbiddenDirectory: absolutePathSchema.optional(),
}).strict()

export const preferencesSchema = z.object({
  lastDirectory: absolutePathSchema.nullable(),
  recentDirectories: z.array(absolutePathSchema).max(10),
  theme: z.enum(['light', 'dark', 'system']),
  sidebarVisible: z.boolean(),
  sidebarWidth: z.number().finite(),
  showDecorations: z.boolean(),
}).strict()

export const dialogKindSchema = z.enum(['info', 'warning', 'error'])

export const askDialogSchema = z.object({
  title: z.string().max(200),
  kind: dialogKindSchema,
  okLabel: z.string().min(1).max(100),
  cancelLabel: z.string().min(1).max(100),
}).strict()

export const messageDialogSchema = z.object({
  title: z.string().max(200),
  kind: dialogKindSchema,
}).strict()

export const resizeDirectionSchema = z.enum([
  'East',
  'North',
  'NorthEast',
  'NorthWest',
  'South',
  'SouthEast',
  'SouthWest',
  'West',
])

export const coordinateSchema = z.number().finite()