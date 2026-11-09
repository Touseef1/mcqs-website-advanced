"use client";

import { CKEditor } from "@ckeditor/ckeditor5-react";
import { Bold, ClassicEditor, Essentials, Italic, List, Paragraph, Underline } from "ckeditor5";
import { containsUrduScript } from "@/lib/language";

const editorConfig = {
  licenseKey: "GPL",
  plugins: [Essentials, Paragraph, Bold, Italic, Underline, List],
  toolbar: ["undo", "redo", "|", "bold", "italic", "underline", "|", "bulletedList", "numberedList"],
  placeholder: "Explain the answer if useful",
};

export function ExplanationEditor({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const isUrdu = containsUrduScript(value);
  return (
    <div className={`mcq-explanation-editor${isUrdu ? " is-urdu" : ""}`} dir={isUrdu ? "rtl" : "ltr"}>
      <CKEditor
        editor={ClassicEditor}
        data={value || "<p></p>"}
        config={editorConfig}
        disabled={disabled}
        onChange={(_, editor) => onChange(editor.getData())}
      />
    </div>
  );
}
