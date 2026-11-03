import argparse
import multiprocessing
import sys
from pathlib import Path


def main():
    if getattr(sys, "frozen", False):
        from .frozen_helpers import dispatch

        if dispatch():
            return
    multiprocessing.freeze_support()
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--worker", type=Path)
    parser.add_argument("--browser-visible", action="store_true")
    parser.add_argument("--mcp", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        from .selftest import run

        return run()
    if args.worker:
        from .worker import main as worker_main

        return worker_main(args.worker, visible=args.browser_visible)
    if args.data_dir is None:
        from platformdirs import user_data_dir

        args.data_dir = Path(user_data_dir("Booster Recruiter", appauthor=False))
    if args.mcp:
        from .mcp_bridge import run

        return run(args.data_dir)
    from .api import serve

    serve(args.data_dir)


if __name__ == "__main__":
    main()
