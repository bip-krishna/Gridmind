import { ControlPlane } from "@/components/control-plane";
import { getProject } from "@/lib/db";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();

  return <ControlPlane projectId={id} projectName={project.name} repoPath={project.repo_path} githubRepo={project.github_repo} />;
}