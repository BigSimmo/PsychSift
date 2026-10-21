#!/bin/sh
# Run in the Debian source directory after its normal package build.
set -eu
source_dir=$(pwd)
library=$(find . -type f -name libcommon.la ! -path '*/.libs/*')
case "$library" in
  ''|*'
'*) echo 'Expected exactly one built libcommon.la' >&2; exit 1 ;;
esac
build_dir=$(cd "$(dirname "$library")" && pwd)
test -f "$build_dir/config.h"
test -f "$build_dir/libtool"
probe_dir=$(mktemp -d)
trap 'rm -rf "$probe_dir"' EXIT HUP INT TERM
mkdir -p "$probe_dir/inside/child"
printf 'control\n' > "$probe_dir/inside/child/file"
printf 'outside\n' > "$probe_dir/outside"
ln -s child/file "$probe_dir/inside/leaf"
ln -s child "$probe_dir/inside/ancestor"
ln -s ../outside "$probe_dir/inside/escape"
cat > "$probe_dir/probe.c" <<'PROBE'
#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1
#endif
#include "config.h"
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "fileutils.h"
/* Do not include linux/openat2.h first: libmount callers need this fallback. */
_Static_assert(RESOLVE_NO_SYMLINKS == 0x04, "NO_SYMLINKS must reject ordinary symlinks");
_Static_assert(RESOLVE_BENEATH == 0x08, "BENEATH must match Linux UAPI");

static void allowed(int fd, const char *name)
{
    char bytes[8] = {0};
    if (fd < 0) {
        perror(name); /* ENOSYS/EPERM is an unavailable required proof, never a skip. */
        exit(1);
    }
    if (read(fd, bytes, sizeof(bytes)) != 8 || memcmp(bytes, "control\n", 8)) {
        fprintf(stderr, "%s: wrong control file\n", name);
        exit(1);
    }
    if (close(fd)) exit(1);
}

static void denied(int fd, int error, const char *name)
{
    if (fd >= 0) {
        close(fd);
        fprintf(stderr, "%s: forbidden path opened\n", name);
        exit(1);
    }
    if (errno != error) {
        fprintf(stderr, "%s: expected errno %d, got %d\n", name, error, errno);
        exit(1);
    }
}

int main(int argc, char **argv)
{
    char path[4096];
    const char *links[] = {"leaf", "ancestor/file"};
    int dirfd;
    if (argc != 2) return 1;
    dirfd = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dirfd < 0) { perror("open fixture directory"); return 1; }
    if (snprintf(path, sizeof(path), "%s/child/file", argv[1]) >= (int) sizeof(path)) return 1;
    allowed(ul_open_no_symlinks(path, O_RDONLY | O_CLOEXEC, 0), "no-symlinks control");
    allowed(ul_openat_resolve(dirfd, "child/file", O_RDONLY | O_CLOEXEC, 0,
                             RESOLVE_NO_SYMLINKS), "resolve control");
    allowed(ul_openat_resolve(dirfd, "child/file", O_RDONLY | O_CLOEXEC, 0,
                             RESOLVE_BENEATH), "beneath control");
    for (size_t i = 0; i < sizeof(links) / sizeof(links[0]); i++) {
        if (snprintf(path, sizeof(path), "%s/%s", argv[1], links[i]) >= (int) sizeof(path)) return 1;
        denied(ul_open_no_symlinks(path, O_RDONLY | O_CLOEXEC, 0), ELOOP, links[i]);
        denied(ul_openat_resolve(dirfd, links[i], O_RDONLY | O_CLOEXEC, 0,
                                RESOLVE_NO_SYMLINKS), ELOOP, links[i]);
    }
    denied(ul_openat_resolve(dirfd, "../outside", O_RDONLY | O_CLOEXEC, 0,
                            RESOLVE_BENEATH), EXDEV, "parent traversal");
    denied(ul_openat_resolve(dirfd, "escape", O_RDONLY | O_CLOEXEC, 0,
                            RESOLVE_BENEATH), EXDEV, "symlink escape");
    if (close(dirfd)) return 1;
    puts("util-linux openat2 regressions: 3 controls and 6 forbidden paths passed");
    return 0;
}
PROBE
cd "$build_dir"
./libtool --mode=link --tag=CC "${CC:-cc}" -std=c11 -DHAVE_CONFIG_H \
  -I"$build_dir" -I"$source_dir/include" "$probe_dir/probe.c" \
  "$build_dir/libcommon.la" -o "$probe_dir/probe"
"$probe_dir/probe" "$probe_dir/inside"
