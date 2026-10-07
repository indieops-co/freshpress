import { useMemo, useState } from 'react';
import { Filter, FolderPlus } from 'lucide-react';
import { api, type EmailFolder } from '../../api';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import NewFilterModal from './NewFilterModal';

interface Props {
  siteId: string;
  folders: EmailFolder[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onFoldersChanged: () => void;
  /** folderId -> unread count, excluding filtered/spam per spec (caller computes this from thread lists). */
  unreadCounts: Record<string, number>;
}

interface Tree {
  folder: EmailFolder;
  children: EmailFolder[];
}

export default function FolderSidebar({
  siteId,
  folders,
  selectedFolderId,
  onSelectFolder,
  onFoldersChanged,
  unreadCounts,
}: Props) {
  const [menu, setMenu] = useState<{ position: { x: number; y: number }; folder: EmailFolder } | null>(null);
  const [filterModalFolder, setFilterModalFolder] = useState<EmailFolder | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const tree = useMemo<Tree[]>(() => {
    const roots = folders.filter((f) => !f.parentFolderId);
    return roots.map((folder) => ({
      folder,
      children: folders.filter((f) => f.parentFolderId === folder.id),
    }));
  }, [folders]);

  async function handleRename(folder: EmailFolder) {
    const name = window.prompt('Rename folder', folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    await api.updateInboxFolder(siteId, folder.id, { name: name.trim() });
    onFoldersChanged();
  }

  async function handleDelete(folder: EmailFolder) {
    if (!window.confirm(`Delete "${folder.name}"? Its emails will move back to Inbox.`)) return;
    await api.deleteInboxFolder(siteId, folder.id);
    onFoldersChanged();
  }

  async function handleMove(folder: EmailFolder) {
    const options = folders.filter((f) => f.id !== folder.id && f.kind === 'custom').map((f) => f.name);
    const choice = window.prompt(
      `Move "${folder.name}" under which folder? (leave blank for top-level)\nOptions: ${options.join(', ') || '(none yet)'}`,
      ''
    );
    if (choice === null) return;
    const target = folders.find((f) => f.name.toLowerCase() === choice.trim().toLowerCase());
    if (choice.trim() && !target) {
      window.alert('No folder with that name.');
      return;
    }
    await api.updateInboxFolder(siteId, folder.id, { parentFolderId: target?.id ?? null });
    onFoldersChanged();
  }

  function contextItemsFor(folder: EmailFolder): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: 'Rename', onClick: () => void handleRename(folder) },
      { label: 'Move', onClick: () => void handleMove(folder) },
      { label: folder.filterRule ? 'Edit Filter' : 'New Filter', onClick: () => setFilterModalFolder(folder) },
    ];
    if (folder.kind === 'custom') {
      items.push({ label: 'Delete', danger: true, onClick: () => void handleDelete(folder) });
    }
    return items;
  }

  function renderFolderRow(folder: EmailFolder, isChild: boolean) {
    return (
      <li key={folder.id} className="folder-sidebar__row">
        <button
          type="button"
          className={`folder-sidebar__item${selectedFolderId === folder.id ? ' folder-sidebar__item--active' : ''}${
            isChild ? ' folder-sidebar__item--child' : ''
          }`}
          onClick={() => onSelectFolder(folder.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ position: { x: e.clientX, y: e.clientY }, folder });
          }}
        >
          <span className="folder-sidebar__color-dot" style={folder.color ? { background: folder.color } : undefined} />
          <span className="folder-sidebar__name">{folder.name}</span>
          {folder.filterRule && (
            <Filter size={13} className="folder-sidebar__filter-icon" aria-label="Has an auto-filter" />
          )}
          {unreadCounts[folder.id] > 0 && (
            <span className="folder-sidebar__badge">{unreadCounts[folder.id]}</span>
          )}
        </button>
      </li>
    );
  }

  return (
    <div className="folder-sidebar">
      <ul className="folder-sidebar__list">
        {tree.map(({ folder, children }) => (
          <div key={folder.id}>
            {renderFolderRow(folder, false)}
            {children.map((child) => renderFolderRow(child, true))}
          </div>
        ))}
      </ul>

      {creating ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            await api.createInboxFolder(siteId, { name: newName.trim() });
            setNewName('');
            setCreating(false);
            onFoldersChanged();
          }}
          style={{ marginTop: '0.5rem' }}
        >
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => !newName.trim() && setCreating(false)}
            placeholder="Folder name"
            style={{ width: '100%' }}
          />
        </form>
      ) : (
        <button type="button" className="secondary folder-sidebar__add" onClick={() => setCreating(true)}>
          <FolderPlus size={14} /> New folder
        </button>
      )}

      {menu && (
        <ContextMenu position={menu.position} items={contextItemsFor(menu.folder)} onClose={() => setMenu(null)} />
      )}

      {filterModalFolder && (
        <NewFilterModal
          siteId={siteId}
          folder={filterModalFolder}
          onClose={() => setFilterModalFolder(null)}
          onSaved={() => {
            setFilterModalFolder(null);
            onFoldersChanged();
          }}
        />
      )}
    </div>
  );
}
