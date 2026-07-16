import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { FilePlus, FileText } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  createDrawing,
  createMarkdownDocument,
} from '../lib/workspaceActions'

interface NewDocumentMenuProps {
  children: ReactNode
  className: string
  title?: string
}

export function NewDocumentMenu({
  children,
  className,
  title = 'New document',
}: NewDocumentMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={className}
          aria-label="New document"
          title={title}
        >
          {children}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="chrome-menu new-document-menu"
          align="start"
          sideOffset={6}
          collisionPadding={8}
        >
          <DropdownMenu.Item
            className="chrome-menu-item"
            onSelect={() => void createDrawing()}
          >
            <FilePlus aria-hidden="true" />
            <span className="chrome-menu-item-label">New drawing</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="chrome-menu-item"
            onSelect={() => void createMarkdownDocument()}
          >
            <FileText aria-hidden="true" />
            <span className="chrome-menu-item-label">New note</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}