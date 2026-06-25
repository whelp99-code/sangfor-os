"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateTaskForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueAt, setDueAt] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        projectSlug: "demo-project",
      }),
    });
    setLoading(false);
    if (response.ok) {
      setTitle("");
      setPriority("normal");
      setDueAt("");
      router.refresh();
    }
  }

  return (
    <form className="grid gap-2 md:grid-cols-4" onSubmit={onSubmit}>
      <Input placeholder="Task title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      <Input placeholder="Priority" value={priority} onChange={(event) => setPriority(event.target.value)} />
      <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
      <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Add task"}</Button>
    </form>
  );
}
