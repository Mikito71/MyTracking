#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sql.h>
#include <sqlext.h>

#define CELL_BUFFER 65536

static void diag(SQLSMALLINT type, SQLHANDLE handle, const char *where) {
  SQLCHAR state[6];
  SQLINTEGER native;
  SQLCHAR text[1024];
  SQLSMALLINT len;
  SQLSMALLINT i = 1;

  fprintf(stderr, "%s failed\n", where);
  while (SQLGetDiagRec(type, handle, i++, state, &native, text, sizeof(text), &len) == SQL_SUCCESS) {
    fprintf(stderr, "[%s] %s\n", state, text);
  }
}

static void print_json_string(const char *value) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
    switch (*p) {
      case '\\': fputs("\\\\", stdout); break;
      case '"': fputs("\\\"", stdout); break;
      case '\b': fputs("\\b", stdout); break;
      case '\f': fputs("\\f", stdout); break;
      case '\n': fputs("\\n", stdout); break;
      case '\r': fputs("\\r", stdout); break;
      case '\t': fputs("\\t", stdout); break;
      default:
        if (*p < 32) {
          printf("\\u%04x", *p);
        } else {
          putchar(*p);
        }
    }
  }
  putchar('"');
}

static char *join_query(int argc, char **argv) {
  size_t total = 1;
  for (int i = 1; i < argc; i++) total += strlen(argv[i]) + 1;

  char *query = calloc(total, 1);
  if (!query) return NULL;

  for (int i = 1; i < argc; i++) {
    if (i > 1) strcat(query, " ");
    strcat(query, argv[i]);
  }

  return query;
}

static SQLRETURN connect_hfsql(SQLHDBC dbc) {
  const char *file_passwords = getenv("HFSQL_FILE_PASSWORDS");
  char connection[2048];
  SQLCHAR out_connection[2048];
  SQLSMALLINT out_len = 0;

  snprintf(
    connection,
    sizeof(connection),
    "DSN=MyTrackingWinDevSGA;UID=Admin;PWD=;%s%s",
    file_passwords && *file_passwords ? "Password=" : "",
    file_passwords && *file_passwords ? file_passwords : ""
  );

  return SQLDriverConnect(
    dbc,
    NULL,
    (SQLCHAR *)connection,
    SQL_NTS,
    out_connection,
    sizeof(out_connection),
    &out_len,
    SQL_DRIVER_NOPROMPT
  );
}

static int open_protected_files(SQLHDBC dbc) {
  const char *file_passwords = getenv("HFSQL_FILE_PASSWORDS");
  if (!file_passwords || !*file_passwords) return 0;

  char buffer[2048];
  strncpy(buffer, file_passwords, sizeof(buffer) - 1);
  buffer[sizeof(buffer) - 1] = '\0';

  char *cursor = buffer;
  while (cursor && *cursor) {
    char *next = strchr(cursor, ';');
    if (next) *next = '\0';

    char *separator = strchr(cursor, ':');
    if (separator && separator != cursor && separator[1] != '\0') {
      *separator = '\0';
      const char *file = cursor;
      const char *password = separator + 1;
      char sql[1024];
      SQLHSTMT open_stmt = SQL_NULL_HSTMT;

      snprintf(sql, sizeof(sql), "OPEN FILE %s USING \"%s\"", file, password);
      SQLRETURN rc = SQLAllocHandle(SQL_HANDLE_STMT, dbc, &open_stmt);
      if (!SQL_SUCCEEDED(rc)) {
        diag(SQL_HANDLE_DBC, dbc, "SQLAllocHandle OPEN FILE");
        return 1;
      }
      rc = SQLExecDirect(open_stmt, (SQLCHAR *)sql, SQL_NTS);
      if (!SQL_SUCCEEDED(rc)) {
        SQLFreeHandle(SQL_HANDLE_STMT, open_stmt);
        return 1;
      }
      SQLFreeHandle(SQL_HANDLE_STMT, open_stmt);
    }

    cursor = next ? next + 1 : NULL;
  }

  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "Usage: hfsql-query <sql>\n");
    return 1;
  }

  char *query = join_query(argc, argv);
  if (!query) {
    fprintf(stderr, "Cannot allocate query.\n");
    return 1;
  }

  SQLHENV env = SQL_NULL_HENV;
  SQLHDBC dbc = SQL_NULL_HDBC;
  SQLHSTMT stmt = SQL_NULL_HSTMT;
  SQLRETURN rc;
  SQLSMALLINT columns = 0;

  rc = SQLAllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &env);
  if (!SQL_SUCCEEDED(rc)) return 2;

  rc = SQLSetEnvAttr(env, SQL_ATTR_ODBC_VERSION, (SQLPOINTER)SQL_OV_ODBC3, 0);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_ENV, env, "SQLSetEnvAttr");
    return 2;
  }

  rc = SQLAllocHandle(SQL_HANDLE_DBC, env, &dbc);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_ENV, env, "SQLAllocHandle DBC");
    return 2;
  }

  rc = connect_hfsql(dbc);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_DBC, dbc, "SQLDriverConnect");
    return 3;
  }

  if (strstr(query, "Utilisateur")) {
    open_protected_files(dbc);
  }

  rc = SQLAllocHandle(SQL_HANDLE_STMT, dbc, &stmt);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_DBC, dbc, "SQLAllocHandle STMT");
    return 4;
  }

  rc = SQLExecDirect(stmt, (SQLCHAR *)query, SQL_NTS);
  free(query);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_STMT, stmt, "SQLExecDirect");
    return 5;
  }

  rc = SQLNumResultCols(stmt, &columns);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_STMT, stmt, "SQLNumResultCols");
    return 6;
  }

  char names[512][256];
  for (SQLSMALLINT i = 1; i <= columns && i <= 512; i++) {
    SQLSMALLINT name_len = 0;
    SQLSMALLINT data_type = 0;
    SQLULEN column_size = 0;
    SQLSMALLINT decimal_digits = 0;
    SQLSMALLINT nullable = 0;
    memset(names[i - 1], 0, sizeof(names[i - 1]));
    SQLDescribeCol(stmt, i, (SQLCHAR *)names[i - 1], sizeof(names[i - 1]) - 1, &name_len, &data_type, &column_size, &decimal_digits, &nullable);
  }

  char cell[CELL_BUFFER];
  while ((rc = SQLFetch(stmt)) == SQL_SUCCESS || rc == SQL_SUCCESS_WITH_INFO) {
    putchar('{');
    for (SQLSMALLINT i = 1; i <= columns && i <= 512; i++) {
      SQLLEN indicator = 0;
      memset(cell, 0, sizeof(cell));
      SQLRETURN get_rc = SQLGetData(stmt, i, SQL_C_CHAR, cell, sizeof(cell), &indicator);
      if (i > 1) putchar(',');
      print_json_string(names[i - 1]);
      putchar(':');
      if (indicator == SQL_NULL_DATA) {
        fputs("null", stdout);
      } else if (SQL_SUCCEEDED(get_rc)) {
        print_json_string(cell);
      } else {
        fputs("null", stdout);
      }
    }
    puts("}");
  }

  if (rc != SQL_NO_DATA) {
    diag(SQL_HANDLE_STMT, stmt, "SQLFetch");
    return 7;
  }

  SQLFreeHandle(SQL_HANDLE_STMT, stmt);
  SQLDisconnect(dbc);
  SQLFreeHandle(SQL_HANDLE_DBC, dbc);
  SQLFreeHandle(SQL_HANDLE_ENV, env);
  return 0;
}
