#!/usr/bin/env python3
"""Exercise the built Python SAX callback's ownership of enumeration strings."""
import pathlib
import sys

import libxml2mod


expected_directory = pathlib.Path(sys.argv[1]).resolve()
assert pathlib.Path(libxml2mod.__file__).resolve().is_relative_to(expected_directory)


class Handler:
    def __init__(self):
        self.declarations = []

    def attributeDecl(self, element, name, kind, default_kind, default, values):
        # Retain the actual list: its strings must survive the callback and GC.
        self.declarations.append((element, name, values))


first = "first_" + "a" * 96
second = "second_" + "b" * 96
document = (
    '<!DOCTYPE root [<!ELEMENT root EMPTY>'
    f'<!ATTLIST root selection ({first}|{second}) #IMPLIED>'
    '<!ATTLIST root ordinary CDATA #IMPLIED>]><root/>'
)
for _ in range(32):
    handler = Handler()
    context = libxml2mod.xmlCreatePushParser(handler, None, 0, "synthetic.xml")
    try:
        assert libxml2mod.xmlParseChunk(context, document, len(document), 1) == 0
    finally:
        libxml2mod.xmlFreeParserCtxt(context)
    # Exercise allocator reuse before reading strings retained by the callback.
    churn = [str(index) + "x" * 120 for index in range(128)]
    assert handler.declarations == [
        ("root", "selection", [first, second]),
        ("root", "ordinary", []),
    ]
    assert len(churn) == 128

print("CVE-2026-74860: 32 SAX enumeration/list ownership controls passed")
