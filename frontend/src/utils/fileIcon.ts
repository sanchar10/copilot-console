/** Map a filename to an emoji icon based on its extension. */
export function fileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📑';
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) return '📊';
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return '📝';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return '📦';
  if (['js', 'ts', 'py', 'java', 'cpp', 'c', 'rs', 'go', 'rb', 'cs', 'sh', 'json', 'yaml', 'yml', 'xml', 'html', 'css'].includes(ext)) return '💻';
  if (['md', 'txt', 'log'].includes(ext)) return '📃';
  return '📄';
}
