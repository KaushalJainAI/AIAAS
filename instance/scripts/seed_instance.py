#!/usr/bin/env python3
"""
instance/scripts/seed_instance.py

Idempotent ORM seeder — creates the "regular user" world directly in Django.
Wipes ONLY rows owned by instance personas, so re-running is safe and does NOT
touch real users.

What it seeds (mirrors instance/docs/USER_JOURNEY.md §2):
  - users (PERSONAS) + profile tier
  - folders (Reports, Invoices, Q1)
  - knowledge bases + documents (with HNSW indexing)
  - agents (Finance helper, Researcher, Docs librarian)
  - optional: ToolConfig overlays, triggers for scheduled agent

Run:
  python instance/scripts/seed_instance.py              # from repo root
  python instance/scripts/seed_instance.py --fresh      # also wipes then re-seeds
  DJANGO_SETTINGS_MODULE=workflow_backend.settings.local python instance/scripts/seed_instance.py

Requires: Backend/.env with SECRET_KEY + CREDENTIAL_ENCRYPTION_KEY, DB migrated.
"""
from __future__ import annotations

import os
import sys
import argparse
from pathlib import Path

# --- bootstrap Django ---
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "Backend"
sys.path.insert(0, str(BACKEND_ROOT))
sys.path.insert(0, str(REPO_ROOT))

from instance.scripts.utils import console  # noqa: E402,F401  (UTF-8 stdout)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "workflow_backend.settings.local")

import django  # noqa: E402
django.setup()

from django.contrib.auth.models import User  # noqa: E402
from django.core.files.base import ContentFile  # noqa: E402
from django.utils import timezone  # noqa: E402

from agents.models import SubAgent  # noqa: E402
from inference.models import KnowledgeBase, Document, Folder  # noqa: E402
from chat.models import ChatSession  # noqa: E402
from skills.models import Skill  # noqa: E402

from instance.scripts.utils.fixtures import PERSONAS, ALL_AGENTS, KB_DEFS, DOCS, FOLDERS  # noqa: E402
from instance.scripts.utils import testenv  # noqa: E402

DEMO_PROVIDER = testenv.get("E2E_DEMO_PROVIDER", "nvidia")
DEMO_MODEL = testenv.get("E2E_DEMO_MODEL", "openai/gpt-oss-20b")


def upsert_users() -> list[User]:
    users: list[User] = []
    for p in PERSONAS:
        email = p["email"]
        username = email  # login is email; keep username == email
        user, created = User.objects.get_or_create(
            username=username,
            defaults={"email": email, "first_name": p["first_name"], "last_name": p["last_name"]},
        )
        user.email = email
        user.first_name, user.last_name = p["first_name"], p["last_name"]
        user.is_active = True
        user.set_password(p["password"])
        user.save()
        if hasattr(user, "profile") and user.profile:
            try:
                user.profile.tier = "pro"
                # Pin the persona's chat model too, not just the agents'.
                # `UserProfile.llm_model` defaults to the platform default,
                # which is the model measured at ~50% "Service temporarily
                # overloaded" -- so a seeded demo user could build a reliable
                # agent and still have the *chat* answer nothing. Both surfaces
                # now come from the same two lines in instance/test.env.
                user.profile.llm_provider = DEMO_PROVIDER
                user.profile.llm_model = DEMO_MODEL
                user.profile.save(
                    update_fields=["tier", "llm_provider", "llm_model"]
                )
            except Exception as e:
                print(f"  ! profile defaults skip for {email}: {e}")
        tag = "created" if created else "updated"
        print(f"  {tag:8s} user {email} (id={user.id})")
        users.append(user)
    return users


def seed_folders(user: User) -> dict[str, Folder]:
    # Wipe only this user's folders (LiveManager hides trashed; use _base_manager for hard wipe)
    Folder._base_manager.filter(user=user).delete()
    created: dict[str, Folder] = {}
    # create in order; parents first
    for f in FOLDERS:
        parent = created.get(f["parent"]) if f["parent"] else None
        folder = Folder.objects.create(
            user=user,
            parent=parent,
            name=f["name"],
            # path/depth computed in save(); just create
        )
        # refresh to get path
        folder.refresh_from_db()
        created[f["name"]] = folder
        print(f"  created folder {folder.path} {folder.name!r} (id={folder.id})")
    return created


def seed_kbs_and_docs(user: User, folders: dict[str, Folder]) -> tuple[list[KnowledgeBase], list[Document]]:
    # index docs via HNSW if available; otherwise status=stored still shows in UI
    try:
        from inference.engine import get_hnsw_kb  # noqa: F401
        from asgiref.sync import async_to_sync  # noqa: F401
        hnsw_available = True
    except Exception as e:
        print(f"  ! HNSW not available ({e}) — docs will be stored without vectors")
        hnsw_available = False

    KnowledgeBase.objects.filter(user=user).delete()
    # Document wipes cascades chunks/terms via collector; hard delete via base manager
    Document._base_manager.filter(user=user).delete()

    kbs: dict[str, KnowledgeBase] = {}
    for kd in KB_DEFS:
        kb = KnowledgeBase.objects.create(
            user=user,
            name=kd["name"],
            description=kd["description"],
            is_default=kd.get("is_default", False),
        )
        kbs[kd["name"]] = kb
        print(f"  created kb {kb.name!r} (id={kb.id})")

    docs: list[Document] = []
    doc_counts: dict[int, int] = {kb.id: 0 for kb in kbs.values()}

    for d in DOCS:
        kb = kbs[d["kb"]]
        body: str = d["body"]
        content = body.encode()
        # pick a folder: invoices → Invoices, docs → Reports
        folder = folders.get("Invoices" if "invoice" in d["name"].lower() else "Reports")

        doc = Document.objects.create(
            user=user,
            knowledge_base=kb,
            name=d["name"],
            file_type=d["file_type"],
            file_size=len(content),
            status="indexed" if hnsw_available else "stored",
            content_text=body,
            folder=folder,
        )
        doc.file.save(d["name"], ContentFile(content), save=True)

        if hnsw_available:
            try:
                from inference.engine import get_hnsw_kb
                from asgiref.sync import async_to_sync
                hnsw = get_hnsw_kb(kb.id, kb.s3_index_key or f"indices/kb_{kb.id}")

                async def _index(h=hnsw, doc_id=doc.id, txt=body, kb_id=kb.id):  # type: ignore
                    await h.initialize()
                    return await h.add_document(doc_id, txt, {"name": doc.name, "user_id": user.id, "kb_id": kb_id})

                chunks = async_to_sync(_index)()
                doc.chunk_count = len(chunks) if chunks else 1
                doc.save(update_fields=["chunk_count"])
                doc_counts[kb.id] += 1
            except Exception as e:
                print(f"  ! index {d['name']!r}: {e} — leaving as stored")
                doc.status = "stored"
                doc.save(update_fields=["status"])
        else:
            doc_counts[kb.id] += 1

        docs.append(doc)
        print(f"  created doc {d['name']!r} kb={kb.name!r} folder={folder.name if folder else 'root'} status={doc.status}")

    if hnsw_available:
        for kb in kbs.values():
            try:
                from inference.engine import get_hnsw_kb
                hnsw = get_hnsw_kb(kb.id, kb.s3_index_key or f"indices/kb_{kb.id}")
                kb.doc_count = doc_counts[kb.id]
                kb.vector_count = getattr(hnsw, "ntotal", doc_counts[kb.id])
                kb.save(update_fields=["doc_count", "vector_count"])
            except Exception:
                pass

    return list(kbs.values()), docs


def seed_agents(user: User) -> list[SubAgent]:
    SubAgent.objects.filter(user=user).delete()
    objs: list[SubAgent] = []
    for cfg in ALL_AGENTS:
        obj = SubAgent.objects.create(
            user=user,
            name=cfg["name"],
            description=cfg["brief"],
            prompt=cfg["brief"],
            status="active",
            tags=[],
            llm_provider=cfg.get("provider", "nvidia"),
            llm_model=cfg.get("model", "openai/gpt-oss-20b"),
            tool_grants=cfg.get("tools", {}),
            guardrails={
                "autonomy": cfg.get("autonomy", "ask"),
                "spendCapRupees": cfg.get("spendCapRupees", 500),
                "egress": cfg.get("egress", "none"),
                "maxRunSeconds": cfg.get("maxRunSeconds", 300),
            },
            agent_context={"connectors": [], "skills": [], "knowledgeBases": [], "useOrgContext": False},
            sandbox={
                "fileAccess": cfg.get("fileAccess", "scoped"),
                "workdir": "/workspace",
                "venv": False,
            },
            output_schema={},
            fanout={},
            runtime_settings={
                "temperature": cfg.get("temperature", 0.2),
                "compaction": cfg.get("compaction", True),
                "recursiveContext": cfg.get("recursiveContext", False),
                "indexing": cfg.get("indexing", True),
            },
        )
        objs.append(obj)
        print(f"  created agent {obj.name!r} (id={obj.id}) autonomy={cfg.get('autonomy')} tools={cfg.get('tools')}")
    return objs


def seed_chat_and_skills(user: User) -> None:
    ChatSession.objects.filter(user=user).delete()
    Skill.objects.filter(user=user).delete()
    # one welcome session so /ai-chat history isn't empty
    from chat.models import ChatSession as CS, ChatMessage  # noqa: F401
    sess = CS.objects.create(user=user, title="Welcome — instance seed")
    ChatMessage.objects.create(session=sess, role="assistant", content=(
        "Hi! I'm your instance seed. Try: ask me about getting started, "
        "or run the Finance helper on the invoices in Documents → Invoices."
    ))
    print(f"  created chat session {sess.id}")
    # skills are optional; leave empty or add one
    print("  skills: (skipped — add via instance/dummy-data if needed)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed instance personas + KB + agents (idempotent)")
    ap.add_argument("--fresh", action="store_true", help="wipe instance users then re-seed (also clears profiles)")
    ap.add_argument("--only", choices=["users", "folders", "kbs", "agents", "chat"], help="seed only this slice")
    args = ap.parse_args()

    if args.fresh:
        # hard wipe instance users by email
        emails = [p["email"] for p in PERSONAS]
        qs = User.objects.filter(email__in=emails)
        print(f"fresh: deleting {qs.count()} instance users and their owned rows via CASCADE …")
        qs.delete()

    print(f"\nSeeding instance world → {User.objects.count()} users exist overall")
    users = upsert_users()

    # seed per primary persona (regular_user) for richest demo
    primary = User.objects.get(email=PERSONAS[0]["email"])
    print(f"\nSeeding folders for {primary.email} …")
    folders = seed_folders(primary)

    print(f"\nSeeding KBs + docs for {primary.email} …")
    kbs, docs = seed_kbs_and_docs(primary, folders)

    print(f"\nSeeding agents for {primary.email} …")
    agents = seed_agents(primary)

    print(f"\nSeeding chat for {primary.email} …")
    seed_chat_and_skills(primary)

    # also seed bare agents for other personas so permission tests have them
    for other in PERSONAS[1:]:
        try:
            u = User.objects.get(email=other["email"])
            if SubAgent.objects.filter(user=u).exists():
                continue
            print(f"\nSeeding agents for {u.email} …")
            seed_agents(u)
        except User.DoesNotExist:
            pass

    print("\nINSTANCE SEED COMPLETE")
    print(f"  users:   {[p['email'] for p in PERSONAS]}")
    print(f"  folders: {list(folders.keys())}")
    print(f"  kbs:     {[kb.name for kb in kbs]} ({len(docs)} docs)")
    print(f"  agents:  {[a.name for a in agents]}")
    print(f"  login:   {primary.email} / {PERSONAS[0]['password']}")


if __name__ == "__main__":
    main()
