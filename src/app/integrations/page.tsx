"use client";

import Link from "next/link";
import { GithubConnect } from "@/components/github-connect";
import { ThemeToggle } from "@/components/theme-provider";
import { AgentConnections } from "@/components/agent-connections";

export default function IntegrationsPage() {
  return <main className="min-h-screen bg-bg text-fg">
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-6"><Link href="/" className="text-sm font-semibold tracking-tight">← Gridmind workspace</Link><ThemeToggle /></header>
      <div className="pb-8 pt-10 sm:pb-10 sm:pt-14"><p className="mb-3 text-sm font-medium text-fg-muted">Workspace settings</p><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Apps & integrations</h1><p className="mt-4 max-w-2xl text-base leading-7 text-fg-muted">Connect your AI apps to project memory and bring repository work into Gridmind.</p></div>
      <AgentConnections />
      <GithubConnect />
      <div className="mt-8 grid gap-6 border-t border-border pt-8 sm:grid-cols-2">
        <section><h2 className="text-sm font-semibold">One connection, your projects</h2><p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">This local installation shares the connection across its dashboard projects. Repository access still follows the permissions you grant on GitHub.</p></section>
        <section><h2 className="text-sm font-semibold">You choose when to publish</h2><p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">Linking a repository does not push code or open a pull request. Those actions happen only when you request them from a project.</p></section>
      </div>
    </div>
  </main>;
}
