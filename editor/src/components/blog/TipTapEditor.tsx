import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';

interface Props {
  content: string;
  onChange: (html: string) => void;
}

export default function TipTapEditor({ content, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    onUpdate: ({ editor: ed }) => onChange(ed.getHTML()),
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className="tiptap-wrap">
      <div className="tiptap-toolbar">
        <button type="button" className="secondary" onClick={() => editor.chain().focus().toggleBold().run()}>
          Bold
        </button>
        <button type="button" className="secondary" onClick={() => editor.chain().focus().toggleItalic().run()}>
          Italic
        </button>
        <button type="button" className="secondary" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </button>
        <button type="button" className="secondary" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          H3
        </button>
        <button type="button" className="secondary" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          List
        </button>
      </div>
      <EditorContent editor={editor} className="tiptap-editor" />
    </div>
  );
}
