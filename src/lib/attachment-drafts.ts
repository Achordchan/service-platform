// 待上传附件草稿：上传前可编辑展示标题（默认文件名）与备注
export type AttachmentDraft = {
  id: string;
  file: File;
  title: string;
  note: string;
};

let draftSeq = 0;

export function createAttachmentDrafts(files: File[]): AttachmentDraft[] {
  return files.map((file) => ({
    id: `draft-${Date.now()}-${draftSeq++}`,
    file,
    title: file.name,
    note: "",
  }));
}

/** 标题与文件名一致（用户未改默认值）时不提交，展示端兜底 originalName */
export function appendDraftMeta(formData: FormData, draft: AttachmentDraft) {
  const title = draft.title.trim();
  if (title && title !== draft.file.name) {
    formData.append("title", title);
  }
  const note = draft.note.trim();
  if (note) {
    formData.append("note", note);
  }
}
