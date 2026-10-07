import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { countUsers, listFiles } from "@/lib/db/repo";
import { AppHeader } from "@/components/layout/app-header";
import { UploadForm } from "@/components/files/upload-form";
import { DeleteFileButton } from "@/components/files/delete-file-button";
import { ProcessingWatcher } from "@/components/files/processing-watcher";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const statusStyles: Record<string, string> = {
  uploaded: "bg-muted text-muted-foreground border-border",
  indexed: "bg-success/15 text-success border-success/30",
  processing: "bg-warning/15 text-warning border-warning/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    const existingUsers = await countUsers();
    redirect(existingUsers === 0 ? "/setup" : "/login");
  }

  const files = await listFiles(user.workspaceId);
  const canManageFiles = user.role === "owner" || user.role === "standard";

  return (
    <div className="flex flex-1 flex-col bg-background text-foreground">
      <AppHeader user={user} />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-8 py-16">
        <section className="flex flex-col gap-4">
          <h1 className="font-heading text-5xl leading-tight">
            Ask your business files anything.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            Private AI search across your PDFs, scans, spreadsheets, and job
            files — with cited answers from your own documents.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Files</CardTitle>
              <CardDescription>
                {files.length === 0
                  ? "No files uploaded yet."
                  : `${files.length} file${files.length === 1 ? "" : "s"} in this workspace`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Upload a file to get started.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Uploaded by</TableHead>
                      {canManageFiles && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((file) => (
                      <TableRow key={file.id}>
                        <TableCell className="max-w-60 truncate">
                          {file.filename}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatFileSize(file.fileSize)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={statusStyles[file.processingStatus]}
                          >
                            {file.processingStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {file.uploadedByName ?? "—"}
                        </TableCell>
                        {canManageFiles && (
                          <TableCell>
                            <DeleteFileButton fileId={file.id} />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upload files</CardTitle>
              <CardDescription>
                PDF, DOCX, CSV, XLSX, TXT, Markdown, PNG, JPG
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canManageFiles ? (
                <UploadForm />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Read-only accounts can search and view files, but can&apos;t
                  upload or delete them.
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
