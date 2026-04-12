import { useState, useRef, useCallback } from 'react';
import type { DragEvent, ClipboardEvent } from 'react';
import { uploadFile } from '../../api/sessions';
import type { AttachmentRef, UploadedFile } from '../../api/sessions';

export interface UploadedAttachment extends UploadedFile {
  attachmentRef: AttachmentRef;
}

/**
 * Encapsulates file upload state: drag-and-drop, paste, click-to-upload,
 * pending files (pre-session), and uploaded attachments.
 */
export function useFileUpload(sessionId?: string) {
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // No session yet (new session tab) — store raw files for upload at submit time
    if (!sessionId) {
      setPendingFiles((prev) => [...prev, ...fileArray]);
      return;
    }

    setIsUploading(true);
    try {
      const results = await Promise.all(
        fileArray.map(async (file) => {
          const uploaded = await uploadFile(file, sessionId);
          return {
            ...uploaded,
            attachmentRef: { type: 'file' as const, path: uploaded.path, displayName: uploaded.originalName },
          };
        })
      );
      setAttachments((prev) => [...prev, ...results]);
    } catch (err) {
      console.error('Failed to upload files:', err);
    } finally {
      setIsUploading(false);
    }
  }, [sessionId]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }, [handleFiles]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = '';
  }, [handleFiles]);

  /** Clear uploaded attachments and return their refs for submission. */
  const consumeAttachments = useCallback((): AttachmentRef[] => {
    const refs = attachments.map((a) => a.attachmentRef);
    setAttachments([]);
    return refs;
  }, [attachments]);

  /** Clear pending files and return them for upload. */
  const consumePendingFiles = useCallback((): File[] => {
    const files = [...pendingFiles];
    setPendingFiles([]);
    return files;
  }, [pendingFiles]);

  return {
    attachments,
    pendingFiles,
    isDragOver,
    isUploading,
    fileInputRef,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    handleFiles,
    removeAttachment,
    removePendingFile,
    openFilePicker,
    onFileInputChange,
    consumeAttachments,
    consumePendingFiles,
  };
}
