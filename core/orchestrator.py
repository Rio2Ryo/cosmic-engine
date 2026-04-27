#!/usr/bin/env python3
"""
Cosmic Engine - Orchestrator Core
Multi-agent autonomous development orchestrator.
Manages task decomposition, agent lifecycle, and dependency resolution.
"""

import json
import os
import time
import uuid
import subprocess
import threading
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
AGENTS_DIR = Path(__file__).parent.parent / "agents"
TASKS_FILE = DATA_DIR / "tasks.json"
MEMORY_FILE = DATA_DIR / "memory.json"
LOG_FILE = DATA_DIR / "orchestrator.log"

DATA_DIR.mkdir(parents=True, exist_ok=True)


class Task:
    def __init__(self, name, description, agent_type, dependencies=None, payload=None):
        self.id = str(uuid.uuid4())[:8]
        self.name = name
        self.description = description
        self.agent_type = agent_type
        self.dependencies = dependencies or []
        self.payload = payload or {}
        self.status = "pending"  # pending, running, completed, failed
        self.assigned_to = None
        self.output = None
        self.error = None
        self.created_at = datetime.now().isoformat()
        self.started_at = None
        self.completed_at = None
        self.retries = 0
        self.max_retries = 2

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "agent_type": self.agent_type,
            "dependencies": self.dependencies,
            "payload": self.payload,
            "status": self.status,
            "assigned_to": self.assigned_to,
            "output": self.output,
            "error": self.error,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "retries": self.retries,
            "max_retries": self.max_retries,
        }

    @classmethod
    def from_dict(cls, d):
        t = cls(d["name"], d["description"], d["agent_type"], d.get("dependencies", []), d.get("payload", {}))
        t.id = d["id"]
        t.status = d["status"]
        t.assigned_to = d.get("assigned_to")
        t.output = d.get("output")
        t.error = d.get("error")
        t.created_at = d.get("created_at", t.created_at)
        t.started_at = d.get("started_at")
        t.completed_at = d.get("completed_at")
        t.retries = d.get("retries", 0)
        t.max_retries = d.get("max_retries", 2)
        return t


class Orchestrator:
    def __init__(self):
        self.tasks = {}
        self.running = False
        self._lock = threading.Lock()
        self._load_state()

    def _load_state(self):
        if TASKS_FILE.exists():
            try:
                data = json.loads(TASKS_FILE.read_text())
                self.tasks = {k: Task.from_dict(v) for k, v in data.items()}
                self.log(f"Loaded {len(self.tasks)} tasks from state")
            except Exception as e:
                self.log(f"Failed to load state: {e}")

    def _save_state(self):
        data = {k: v.to_dict() for k, v in self.tasks.items()}
        TASKS_FILE.write_text(json.dumps(data, indent=2))
        self.log(f"Saved {len(self.tasks)} tasks to state")

    def log(self, message):
        timestamp = datetime.now().isoformat()
        entry = f"[{timestamp}] {message}"
        print(entry)
        with open(LOG_FILE, "a") as f:
            f.write(entry + "\n")

    def add_task(self, name, description, agent_type, dependencies=None, payload=None):
        task = Task(name, description, agent_type, dependencies, payload)
        with self._lock:
            self.tasks[task.id] = task
            self._save_state()
        self.log(f"Added task [{task.id}]: {name} ({agent_type})")
        return task.id

    def add_tasks_from_spec(self, spec):
        """Add multiple tasks from a specification dict."""
        task_ids = {}
        for task_spec in spec:
            deps = [task_ids.get(d, d) for d in task_spec.get("dependencies", [])]
            tid = self.add_task(
                task_spec["name"],
                task_spec["description"],
                task_spec["agent_type"],
                deps,
                task_spec.get("payload", {}),
            )
            task_ids[task_spec.get("ref", task_spec["name"])] = tid
        return task_ids

    def get_ready_tasks(self):
        """Get tasks whose dependencies are all completed."""
        ready = []
        with self._lock:
            for task_id, task in self.tasks.items():
                if task.status != "pending":
                    continue
                deps_met = all(
                    self.tasks[d].status == "completed" if d in self.tasks else True
                    for d in task.dependencies
                )
                if deps_met:
                    ready.append(task)
        return ready

    def get_running_tasks(self):
        with self._lock:
            return [t for t in self.tasks.values() if t.status == "running"]

    def get_task_by_id(self, task_id):
        return self.tasks.get(task_id)

    def assign_task(self, task_id, agent_name):
        with self._lock:
            task = self.tasks.get(task_id)
            if task and task.status == "pending":
                task.status = "running"
                task.assigned_to = agent_name
                task.started_at = datetime.now().isoformat()
                self._save_state()
                self.log(f"Assigned task [{task.id}] '{task.name}' to {agent_name}")
                return True
        return False

    def complete_task(self, task_id, output=None, error=None):
        with self._lock:
            task = self.tasks.get(task_id)
            if task:
                if error:
                    task.status = "failed"
                    task.error = error
                    task.retries += 1
                    self.log(f"Task [{task.id}] '{task.name}' FAILED: {error}")
                    if task.retries < task.max_retries:
                        task.status = "pending"
                        task.started_at = None
                        self.log(f"Retrying task [{task.id}] (attempt {task.retries + 1})")
                else:
                    task.status = "completed"
                    task.output = output
                    task.completed_at = datetime.now().isoformat()
                    self.log(f"Task [{task.id}] '{task.name}' COMPLETED")
                self._save_state()
                return True
        return False

    def run_agent(self, agent_type, task):
        """Execute an agent script for a given task."""
        agent_script = AGENTS_DIR / f"{agent_type}.sh"
        if not agent_script.exists():
            agent_script = AGENTS_DIR / f"{agent_type}.py"
        
        if not agent_script.exists():
            return None, f"Agent script not found: {agent_type}"

        try:
            task_json = json.dumps(task.to_dict())
            env = os.environ.copy()
            env["COSMIC_TASK"] = task_json
            env["COSMIC_AGENT_TYPE"] = agent_type

            result = subprocess.run(
                ["bash", str(agent_script)] if agent_script.suffix == ".sh" else ["python3", str(agent_script)],
                capture_output=True,
                text=True,
                timeout=300,
                env=env,
            )
            
            output = result.stdout.strip()
            error = result.stderr.strip() if result.stderr.strip() else None
            
            if result.returncode != 0:
                return output, error or f"Exit code: {result.returncode}"
            
            return output, None
        except subprocess.TimeoutExpired:
            return None, "Agent timed out (300s)"
        except Exception as e:
            return None, str(e)

    def process_cycle(self):
        """One orchestrator cycle: assign ready tasks to agents."""
        ready = self.get_ready_tasks()
        running = self.get_running_tasks()
        
        self.log(f"Cycle: {len(ready)} ready, {len(running)} running")

        for task in ready:
            agent_name = f"agent-{task.agent_type}-{task.id}"
            if self.assign_task(task.id, agent_name):
                output, error = self.run_agent(task.agent_type, task)
                self.complete_task(task.id, output, error)

        return len(ready)

    def run_continuous(self, interval=3):
        """Run orchestrator continuously."""
        self.running = True
        self.log("Orchestrator started (continuous mode)")
        
        while self.running:
            processed = self.process_cycle()
            pending = len([t for t in self.tasks.values() if t.status == "pending"])
            running = len([t for t in self.tasks.values() if t.status == "running"])
            failed = len([t for t in self.tasks.values() if t.status == "failed"])
            
            if pending == 0 and running == 0:
                if failed > 0:
                    self.log(f"All tasks finished: {failed} failed")
                else:
                    self.log(f"All tasks completed successfully!")
                break
            
            time.sleep(interval)
        
        self.running = False
        self._save_state()

    def stop(self):
        self.running = False
        self.log("Orchestrator stopping...")

    def get_status(self):
        with self._lock:
            tasks = [t.to_dict() for t in self.tasks.values()]
            return {
                "running": self.running,
                "total": len(tasks),
                "pending": sum(1 for t in tasks if t["status"] == "pending"),
                "running_count": sum(1 for t in tasks if t["status"] == "running"),
                "completed": sum(1 for t in tasks if t["status"] == "completed"),
                "failed": sum(1 for t in tasks if t["status"] == "failed"),
                "tasks": tasks,
            }

    def get_logs(self, tail=50):
        if not LOG_FILE.exists():
            return []
        lines = LOG_FILE.read_text().strip().split("\n")
        return lines[-tail:]

    def get_memory(self):
        if MEMORY_FILE.exists():
            return json.loads(MEMORY_FILE.read_text())
        return {"context": {}, "artifacts": []}

    def write_memory(self, key, value):
        mem = self.get_memory()
        mem["context"][key] = value
        MEMORY_FILE.write_text(json.dumps(mem, indent=2))

    def add_artifact(self, name, path, description=""):
        mem = self.get_memory()
        mem["artifacts"].append({
            "name": name,
            "path": path,
            "description": description,
            "created_at": datetime.now().isoformat(),
        })
        MEMORY_FILE.write_text(json.dumps(mem, indent=2))


# Global instance
_orchestrator = None

def get_orchestrator():
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = Orchestrator()
    return _orchestrator


if __name__ == "__main__":
    orch = get_orchestrator()
    # Demo: scaffold a project
    spec = [
        {
            "ref": "scaffold",
            "name": "Scaffold Project",
            "description": "Scaffold a new web project",
            "agent_type": "scaffold",
            "payload": {"project_name": "demo-app", "template": "react-ts"},
        },
        {
            "ref": "code-gen",
            "name": "Generate Components",
            "description": "Generate React components",
            "agent_type": "code-gen",
            "dependencies": ["scaffold"],
            "payload": {"component": "App", "language": "typescript"},
        },
        {
            "ref": "test",
            "name": "Run Tests",
            "description": "Run test suite",
            "agent_type": "test",
            "dependencies": ["code-gen"],
            "payload": {"framework": "vitest"},
        },
    ]
    orch.add_tasks_from_spec(spec)
    orch.run_continuous()
