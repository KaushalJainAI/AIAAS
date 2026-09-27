# Dependency Conflicts & Mock Workarounds

## The Problem: The "MRO Conflict" Crash
When integrating complex libraries like **LangGraph** (v0.5.2), you may encounter a `TypeError: Cannot create a consistent method resolution order (MRO) for bases ABC, Generic`. 

This is a deep Python-level error where the class inheritance hierarchy of the library is incompatible with the version of Python or other installed libraries in your specific environment (often Windows). 

**Impact:** Because many libraries are imported at the top level of Django apps, this error can crash the entire server, preventing:
- Database migrations (`makemigrations`, `migrate`)
- Development server startup (`runserver`)
- Testing

## The Solution: Local Package "Neutralization"

When a library is critical for the long-term architecture but its current version is "poisoning" the environment, you can use the **Local Mock Pattern**.

### 1. How it Works
Python's `sys.path` prioritizes the current working directory. By creating a folder with the same name as the problematic library inside your project root, you override the installed site-package.

### 2. Implementation in this Project
- **Directory:** `Backend/langgraph/`
- **Structure:**
  - `langgraph/__init__.py`: Contains empty stubs (`class StateGraph: pass`)
  - `langgraph/graph/__init__.py`: Sub-package stubs.
- **Result:** Django and other apps can now `import langgraph` without crashing. The classes exist but do nothing.

## When to Use This Pattern

| Scenario | Use Mock? | Rationale |
|----------|-----------|-----------|
| **Deployment Blocked** | YES | If you need to migrate the DB or deploy a different part of the system (e.g., Frontend) and the crash is blocking you. |
| **Feature Isolation** | YES | If you are working on Auth/Settings and don't want to fix deep LLM library issues today. |
| **Production Run** | NO | You must fix the underlying conflict before the code that actually *uses* the library is executed. |

## Interview Questions: "Why not just uninstall it?"

**Q: Why did you create a local mock folder instead of just removing the library from requirements.txt?**
**A:** "The library is a core architectural dependency for our agentic logic. Uninstalling it would require deleting or commenting out every import statement in the codebase, which creates a huge diff and is hard to revert. By using a local mock package, I 'neutralized' the crash while keeping the codebase intact. This allowed us to continue developing the rest of the system (Frontend, Auth, Migrations) while we debugged the environment-specific conflict."

**Q: What is a Method Resolution Order (MRO) error?**
**A:** "It's an error that occurs in multiple inheritance when Python cannot find a linear order for the classes that satisfies the C3 Linearization algorithm. It usually means a class is trying to inherit from two parents that have conflicting positions in the hierarchy (e.g., a child trying to be its own grandparent)."
