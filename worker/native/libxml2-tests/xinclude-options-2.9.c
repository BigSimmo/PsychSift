/* Adapt upstream b63cd517 issue1120 cases to 2.9's global loader API.
 * No request is delegated to a network loader, including on test failure.
 */
#define _GNU_SOURCE
#include <assert.h>
#include <dlfcn.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libxml/parser.h>
#include <libxml/parserInternals.h>
#include <libxml/tree.h>
#include <libxml/xinclude.h>
#include <libxml/xmlIO.h>

static int requests, missing_nonet, allow_control, text_control;
static const char *control_cursor;

static int
read_control(void *context, char *buffer, int length) {
    const char **cursor = context;
    size_t remaining = strlen(*cursor);
    size_t count;

    assert(length > 0);
    count = remaining < (size_t) length ? remaining : (size_t) length;
    memcpy(buffer, *cursor, count);
    *cursor += count;
    return (int) count;
}

static xmlParserInputPtr
observe_loader(const char *url, const char *id, xmlParserCtxtPtr ctxt) {
    const char *response;
    xmlParserInputBufferPtr buffer;
    xmlParserInputPtr input;
    (void) id;
    assert(url != NULL);
    assert(strncmp(url, "http://example.invalid/", 23) == 0);
    requests++;
    if (!allow_control) {
        if ((ctxt == NULL) || !(ctxt->options & XML_PARSE_NONET))
            missing_nonet++;
        return NULL;
    }
    assert(ctxt != NULL);
    assert(!(ctxt->options & XML_PARSE_NONET));
    response = text_control ? "Allowed content" : "<p>Allowed content</p>";
    /* The old text loader consumes bytes through xmlParserInputBufferRead.
     * Supply an initially empty IO buffer rather than a pre-filled Mem buffer. */
    control_cursor = response;
    buffer = xmlParserInputBufferCreateIO(read_control, NULL, &control_cursor,
                                         XML_CHAR_ENCODING_NONE);
    assert(buffer != NULL);
    input = xmlNewIOInputStream(ctxt, buffer, XML_CHAR_ENCODING_NONE);
    assert(input != NULL);
    return input;
}

static void
check_case(const char *fixture, int mode, int control, int text) {
    xmlDocPtr doc;
    xmlChar *content;
    int ret;

    requests = missing_nonet = 0;
    allow_control = control;
    text_control = text;
    doc = xmlReadFile(fixture, NULL, control ? 0 : XML_PARSE_NONET);
    assert(doc != NULL);
    /* The ordinary fixture is loaded before installing the loader, so its
     * file read cannot be confused with an XInclude resource request. */
    xmlSetExternalEntityLoader(observe_loader);
    if (mode == 0)
        ret = xmlXIncludeProcess(doc);
    else if (mode == 1)
        ret = xmlXIncludeProcessTree(xmlDocGetRootElement(doc));
    else
        ret = xmlXIncludeProcessFlags(doc, control ? 0 : XML_PARSE_NONET);
    assert(ret >= 0);
    assert(requests == 1);
    assert(missing_nonet == 0);
    content = xmlNodeGetContent(xmlDocGetRootElement(doc));
    assert(content != NULL);
    assert(xmlStrEqual(content, BAD_CAST (control
        ? "\n  Allowed content\n"
        : "\n  Network access is not allowed\n")));
    xmlFree(content);
    xmlFreeDoc(doc);
}

int
main(int argc, char **argv) {
    xmlExternalEntityLoader saved;
    Dl_info loaded;
    char actual[PATH_MAX], expected[PATH_MAX];
    xmlDocPtr ordinary;
    xmlChar *ordinary_content;
    const char *ordinary_xml = "<root><item>ordinary control</item></root>";
    int mode, control, text;

    assert(argc == 4);
    assert(dladdr((void *) xmlReadMemory, &loaded) != 0);
    assert(realpath(loaded.dli_fname, actual) != NULL);
    assert(realpath(argv[3], expected) != NULL);
    assert(strcmp(actual, expected) == 0);
    assert(strcmp(xmlParserVersion, "20914") == 0);
    xmlInitParser();
    assert(xmlHasFeature(XML_WITH_XINCLUDE));
    ordinary = xmlReadMemory(ordinary_xml, (int) strlen(ordinary_xml),
                             "ordinary.xml", NULL, XML_PARSE_NONET);
    assert(ordinary != NULL);
    assert(xmlStrEqual(xmlDocGetRootElement(ordinary)->name, BAD_CAST "root"));
    ordinary_content = xmlNodeGetContent(xmlDocGetRootElement(ordinary));
    assert(xmlStrEqual(ordinary_content, BAD_CAST "ordinary control"));
    xmlFree(ordinary_content);
    xmlFreeDoc(ordinary);
    saved = xmlGetExternalEntityLoader();
    for (mode = 0; mode < 3; mode++) {
        for (control = 0; control < 2; control++) {
            for (text = 0; text < 2; text++) {
                xmlSetExternalEntityLoader(saved);
                check_case(argv[text ? 1 : 2], mode, control, text);
            }
        }
    }
    xmlSetExternalEntityLoader(saved);
    xmlCleanupParser();
    puts("libxml2.so.2: ordinary XML and 12 issue1120 option/loader cases passed");
    return 0;
}
