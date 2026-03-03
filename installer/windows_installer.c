#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <string.h>

static int path_exists(const char *path) {
  DWORD attrs = GetFileAttributesA(path);
  return attrs != INVALID_FILE_ATTRIBUTES;
}

static int dir_exists(const char *path) {
  DWORD attrs = GetFileAttributesA(path);
  return (attrs != INVALID_FILE_ATTRIBUTES) && (attrs & FILE_ATTRIBUTE_DIRECTORY);
}

static void dirname_inplace(char *path) {
  size_t len = strlen(path);
  while (len > 0) {
    if (path[len - 1] == '\\' || path[len - 1] == '/') {
      path[len - 1] = '\0';
      return;
    }
    len--;
  }
}

static int run_and_wait(char *cmdline) {
  STARTUPINFOA si;
  PROCESS_INFORMATION pi;
  DWORD exit_code = 1;

  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESHOWWINDOW;
  si.wShowWindow = SW_HIDE;

  if (!CreateProcessA(
        NULL, cmdline, NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
    return 0;
  }

  WaitForSingleObject(pi.hProcess, INFINITE);
  GetExitCodeProcess(pi.hProcess, &exit_code);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return exit_code == 0;
}

static void open_url_or_path(const char *value) {
  HINSTANCE result = ShellExecuteA(NULL, "open", value, NULL, NULL, SW_SHOWNORMAL);
  (void)result;
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nShowCmd) {
  (void)hInstance;
  (void)hPrevInstance;
  (void)lpCmdLine;
  (void)nShowCmd;

  char exe_path[MAX_PATH];
  char base_dir[MAX_PATH];
  char zip_path[MAX_PATH];
  char ext_dir[MAX_PATH];
  char html_path[MAX_PATH];
  char extract_cmd[4096];
  char message[4096];

  if (!GetModuleFileNameA(NULL, exe_path, MAX_PATH)) {
    MessageBoxA(NULL, "Could not determine installer path.", "Target Checkout Helper Installer", MB_OK | MB_ICONERROR);
    return 1;
  }

  strncpy(base_dir, exe_path, MAX_PATH - 1);
  base_dir[MAX_PATH - 1] = '\0';
  dirname_inplace(base_dir);

  snprintf(zip_path, sizeof(zip_path), "%s\\target-checkout-helper.zip", base_dir);
  snprintf(ext_dir, sizeof(ext_dir), "%s\\target-checkout-helper", base_dir);
  snprintf(html_path, sizeof(html_path), "%s\\INSTALL.html", base_dir);

  if (!path_exists(zip_path)) {
    snprintf(message, sizeof(message),
      "Missing installer payload:\n\n%s\n\n"
      "Put this .exe next to target-checkout-helper.zip and run again.",
      zip_path);
    MessageBoxA(NULL, message, "Target Checkout Helper Installer", MB_OK | MB_ICONERROR);
    return 1;
  }

  if (!dir_exists(ext_dir)) {
    snprintf(extract_cmd, sizeof(extract_cmd),
      "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -LiteralPath \\\"%s\\\" -DestinationPath \\\"%s\\\" -Force\"",
      zip_path, base_dir);
    if (!run_and_wait(extract_cmd) || !dir_exists(ext_dir)) {
      snprintf(message, sizeof(message),
        "Failed to extract extension files.\n\n"
        "Try manually extracting:\n%s\n\nto:\n%s",
        zip_path, base_dir);
      MessageBoxA(NULL, message, "Target Checkout Helper Installer", MB_OK | MB_ICONERROR);
      return 1;
    }
  }

  open_url_or_path("chrome://extensions");
  if (path_exists(html_path)) {
    open_url_or_path(html_path);
  }

  snprintf(message, sizeof(message),
    "Target Checkout Helper is ready.\n\n"
    "1) In Chrome, turn ON Developer mode\n"
    "2) Click Load unpacked\n"
    "3) Select this folder:\n\n%s\n\n"
    "INSTALL.html has been opened with step-by-step help.",
    ext_dir);
  MessageBoxA(NULL, message, "Target Checkout Helper Installer", MB_OK | MB_ICONINFORMATION);
  return 0;
}
