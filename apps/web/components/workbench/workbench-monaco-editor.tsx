import dynamic from "next/dynamic";

export const MonacoEditor = dynamic(
  async () => {
    const [monacoReactModule, monacoModule] = await Promise.all([
      import("@monaco-editor/react"),
      import("monaco-editor"),
    ]);

    monacoReactModule.loader.config({ monaco: monacoModule });

    return monacoReactModule.default;
  },
  {
    ssr: false,
    loading: () => (
      <div className="text-muted-foreground grid h-full place-items-center text-sm">
        Loading editor...
      </div>
    ),
  },
);
