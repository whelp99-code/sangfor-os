"use client";

import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MOCK_PROJECTS } from "@/lib/portal-config";
import { ChevronDown } from "lucide-react";

export function ProjectSelector() {
  const [active, setActive] = useState(MOCK_PROJECTS[0]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className="gap-2">
            {active.name}
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        {MOCK_PROJECTS.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => setActive(project)}
          >
            {project.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
