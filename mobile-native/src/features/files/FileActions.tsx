import { useState } from 'react';
import { useRouter } from 'expo-router';

import { confirm } from '../../components/confirm';
import { appsForDoc, defaultAppFor } from '../apps/catalogue';
import { success, warning } from '../../lib/haptics';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { DetailsSheet } from './DetailsSheet';
import { sendCopy } from './download';
import { errorMessage, handoff } from './helpers';
import { ionIconFor } from './icons';
import { FolderPickerSheet } from './FolderPickerSheet';
import { NameSheet } from './NameSheet';
import { canPreviewNatively, useOpenFile } from './open';
import { useCopyDocument, useMoveItems, useRenameDocument, useTrashDocument, useTrashFolder, useUpdateFolder } from './queries';
import { ShareSheet } from './ShareSheet';
import type { Document, Folder } from './types';

export type FileTarget = { kind: 'folder'; folder: Folder } | { kind: 'file'; doc: Document };

type View = 'menu' | 'rename' | 'move' | 'copy' | 'properties' | 'share' | 'openWith' | 'idle';

interface Props {
  target: FileTarget;
  onClose: () => void;
  notify: (text: string, tone?: 'success' | 'danger') => void;
}

/**
 * The actions for one file or folder, opened from its row. Mount it while it
 * should be open; closing it unmounts it. Mirrors the web's item menu in
 * `pages/Documents.tsx` (`itemMenu`), with the same words where mobile has them.
 */
export function FileActions({ target, onClose, notify }: Props) {
  const router = useRouter();
  const openFile = useOpenFile();
  const [view, setView] = useState<View>('menu');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fileId = target.kind === 'file' ? target.doc.id : 0;
  const folderId = target.kind === 'folder' ? target.folder.id : 0;
  const renameFile = useRenameDocument(fileId);
  const updateFolder = useUpdateFolder(folderId);
  const move = useMoveItems();
  const copy = useCopyDocument();
  const trashDocument = useTrashDocument();
  const trashFolder = useTrashFolder();

  const name = target.kind === 'folder' ? target.folder.name : target.doc.filename;

  /** Closes the menu, then opens the next sheet once the first has left. */
  const show = (next: View) => {
    setView('idle');
    handoff(() => setView(next));
  };

  const askDelete = async () => {
    const ok = await confirm({
      title: 'Move to Trash?',
      message:
        target.kind === 'folder'
          ? `“${name}” and everything in it will be moved to Trash. You can restore it later.`
          : `“${name}” will be moved to Trash. You can restore it later.`,
      destructiveLabel: 'Move to Trash',
    });
    if (!ok) {
      onClose();
      return;
    }
    try {
      if (target.kind === 'folder') await trashFolder.mutateAsync(target.folder.id);
      else await trashDocument.mutateAsync(target.doc.id);
      warning();
      notify('Moved to Trash');
    } catch (err) {
      notify(errorMessage(err, 'Could not move to Trash. Please try again.'), 'danger');
    }
    onClose();
  };

  const rename = async (next: string) => {
    setBusy(true);
    setRenameError(null);
    try {
      if (target.kind === 'folder') await updateFolder.mutateAsync({ name: next });
      else await renameFile.mutateAsync(next);
      success();
      notify('Renamed');
      onClose();
    } catch (err) {
      setRenameError(errorMessage(err, 'Could not rename. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const moveTo = async (folderId: number | null) => {
    setBusy(true);
    try {
      await move.mutateAsync({
        folder_ids: target.kind === 'folder' ? [target.folder.id] : [],
        document_ids: target.kind === 'file' ? [target.doc.id] : [],
        target_folder_id: folderId,
      });
      success();
      notify(`Moved “${name}”`);
    } catch (err) {
      notify(errorMessage(err, 'Could not move. Please try again.'), 'danger');
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const copyTo = async (folderId: number | null) => {
    if (target.kind !== 'file') return;
    setBusy(true);
    try {
      await copy.mutateAsync({ id: target.doc.id, folderId });
      success();
      notify(`Copied “${name}”`);
    } catch (err) {
      notify(errorMessage(err, 'Could not copy. Please try again.'), 'danger');
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const actions: SheetAction[] = [];
  if (target.kind === 'folder') {
    const folder = target.folder;
    actions.push({
      key: 'open',
      label: 'Open',
      icon: 'folder-open-outline',
      onPress: () => {
        onClose();
        router.push(`/files/folder/${folder.id}`);
      },
    });
  } else {
    const doc = target.doc;
    const app = defaultAppFor(doc);
    const native = canPreviewNatively(doc);
    if (native || app) {
      actions.push({
        key: 'open',
        label: native ? 'Preview' : `Open in ${app?.title ?? ''}`,
        icon: native ? 'eye-outline' : ionIconFor(app?.icon ?? 'file'),
        onPress: () => {
          onClose();
          openFile(doc);
        },
      });
    }
    if (appsForDoc(doc).length > 1) {
      actions.push({ key: 'openWith', label: 'Open with', icon: 'open-outline', onPress: () => show('openWith') });
    }
    actions.push({
      key: 'download',
      label: 'Download',
      icon: 'download-outline',
      onPress: () => {
        onClose();
        sendCopy(doc).catch((err: unknown) => notify(errorMessage(err, 'Could not download the file.'), 'danger'));
      },
    });
  }
  actions.push({ key: 'rename', label: 'Rename', icon: 'create-outline', onPress: () => show('rename') });
  actions.push({ key: 'move', label: 'Move to…', icon: 'folder-open-outline', onPress: () => show('move') });
  if (target.kind === 'file') {
    actions.push({ key: 'copy', label: 'Copy to…', icon: 'copy-outline', onPress: () => show('copy') });
    actions.push({ key: 'share', label: 'Share link…', icon: 'share-social-outline', onPress: () => show('share') });
    actions.push({ key: 'properties', label: 'Properties', icon: 'information-circle-outline', onPress: () => show('properties') });
  }
  actions.push({ key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true, onPress: () => void askDelete() });

  const openWithApps = target.kind === 'file' ? appsForDoc(target.doc) : [];

  return (
    <>
      {view === 'menu' ? (
        <ActionSheet title={name} actions={actions} onClose={onClose} />
      ) : null}
      {view === 'rename' ? (
        <NameSheet
          title="Rename"
          initial={name}
          submitLabel="Rename"
          busy={busy}
          error={renameError}
          onSubmit={(next) => void rename(next)}
          onClose={onClose}
        />
      ) : null}
      {view === 'move' ? (
        <FolderPickerSheet
          title="Move to…"
          confirmLabel="Move here"
          excludeIds={target.kind === 'folder' ? [target.folder.id] : []}
          busy={busy}
          onPick={(id) => void moveTo(id)}
          onClose={onClose}
        />
      ) : null}
      {view === 'copy' && target.kind === 'file' ? (
        <FolderPickerSheet
          title="Copy to…"
          confirmLabel="Copy here"
          busy={busy}
          onPick={(id) => void copyTo(id)}
          onClose={onClose}
        />
      ) : null}
      {view === 'properties' && target.kind === 'file' ? (
        <DetailsSheet doc={target.doc} onClose={onClose} notify={notify} />
      ) : null}
      {view === 'share' && target.kind === 'file' ? (
        <ShareSheet doc={target.doc} onClose={onClose} notify={notify} />
      ) : null}
      {view === 'openWith' && target.kind === 'file' ? (
        <ActionSheet
          title="Open with"
          actions={openWithApps.map((app) => ({
            key: app.id,
            label: app.title,
            icon: ionIconFor(app.icon),
            onPress: () => {
              onClose();
              openFile(target.doc, app);
            },
          }))}
          onClose={onClose}
        />
      ) : null}
    </>
  );
}
