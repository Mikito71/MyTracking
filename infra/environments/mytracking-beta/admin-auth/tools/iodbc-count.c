#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sql.h>
#include <sqlext.h>

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

int main(void) {
  SQLHENV env = SQL_NULL_HENV;
  SQLHDBC dbc = SQL_NULL_HDBC;
  SQLHSTMT stmt = SQL_NULL_HSTMT;
  SQLRETURN rc;
  SQLLEN ind = 0;
  char count[64] = {0};

  rc = SQLAllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &env);
  if (!SQL_SUCCEEDED(rc)) {
    fprintf(stderr, "SQLAllocHandle ENV failed\n");
    return 2;
  }

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

  rc = SQLAllocHandle(SQL_HANDLE_STMT, dbc, &stmt);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_DBC, dbc, "SQLAllocHandle STMT");
    return 4;
  }

  rc = SQLExecDirect(stmt, (SQLCHAR *)"SELECT COUNT(*) FROM Clients", SQL_NTS);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_STMT, stmt, "SQLExecDirect");
    return 5;
  }

  rc = SQLFetch(stmt);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_STMT, stmt, "SQLFetch");
    return 6;
  }

  rc = SQLGetData(stmt, 1, SQL_C_CHAR, count, sizeof(count), &ind);
  if (!SQL_SUCCEEDED(rc)) {
    diag(SQL_HANDLE_STMT, stmt, "SQLGetData");
    return 7;
  }

  printf("Clients=%s\n", count);

  SQLFreeHandle(SQL_HANDLE_STMT, stmt);
  SQLDisconnect(dbc);
  SQLFreeHandle(SQL_HANDLE_DBC, dbc);
  SQLFreeHandle(SQL_HANDLE_ENV, env);
  return 0;
}
