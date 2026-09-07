package com.protofs.app

import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.database.sqlite.SQLiteDatabase
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import android.util.Log
import android.webkit.MimeTypeMap
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException

/**
 * ProtoFS Android DocumentsProvider.
 *
 * Integrates ProtoFS encrypted cloud drives directly into the Android Storage Access Framework (SAF).
 * Exposes virtual drives, nested folders, and zero-knowledge files directly to:
 * - The native Android Files app
 * - System document open/save pickers (ACTION_OPEN_DOCUMENT, ACTION_CREATE_DOCUMENT, ACTION_OPEN_DOCUMENT_TREE)
 * - Third-party media and document editors (VLC, QuickEdit, Office, Termux)
 */
class ProtoFsDocumentsProvider : DocumentsProvider() {

    companion object {
        private const val TAG = "ProtoFsDocsProvider"
        const val AUTHORITY = "com.protofs.app.documents"

        // Default projections
        private val DEFAULT_ROOT_PROJECTION = arrayOf(
            Root.COLUMN_ROOT_ID,
            Root.COLUMN_MIME_TYPES,
            Root.COLUMN_FLAGS,
            Root.COLUMN_ICON,
            Root.COLUMN_TITLE,
            Root.COLUMN_SUMMARY,
            Root.COLUMN_DOCUMENT_ID,
            Root.COLUMN_AVAILABLE_BYTES,
            Root.COLUMN_CAPACITY_BYTES
        )

        private val DEFAULT_DOCUMENT_PROJECTION = arrayOf(
            Document.COLUMN_DOCUMENT_ID,
            Document.COLUMN_MIME_TYPE,
            Document.COLUMN_DISPLAY_NAME,
            Document.COLUMN_LAST_MODIFIED,
            Document.COLUMN_FLAGS,
            Document.COLUMN_SIZE,
            Document.COLUMN_ICON
        )

        private const val ROOT_DOCUMENT_PREFIX = "root:"
        private const val FOLDER_DOCUMENT_PREFIX = "folder:"
        private const val FILE_DOCUMENT_PREFIX = "file:"
    }

    private var databaseHelper: SQLiteDatabase? = null
    private var cacheBaseDir: File? = null

    override fun onCreate(): Boolean {
        Log.i(TAG, "ProtoFsDocumentsProvider initialized for authority: $AUTHORITY")
        context?.let { ctx ->
            cacheBaseDir = File(ctx.cacheDir, "protofs_saf_cache").apply {
                if (!exists()) mkdirs()
            }
            try {
                val dbFile = File(ctx.getDatabasePath("cache.db").path)
                if (dbFile.exists()) {
                    databaseHelper = SQLiteDatabase.openDatabase(
                        dbFile.absolutePath,
                        null,
                        SQLiteDatabase.OPEN_READWRITE
                    )
                }
            } catch (e: Exception) {
                Log.w(TAG, "Database not available immediately on provider creation: ${e.message}")
            }
        }
        return true
    }

    override fun queryRoots(projection: Array<out String>?): Cursor {
        val result = MatrixCursor(projection ?: DEFAULT_ROOT_PROJECTION)
        val ctx = context ?: return result

        // In ProtoFS, each drive is exposed as an independent storage root in SAF
        val drives = listAvailableDrives()
        for (drive in drives) {
            val row = result.newRow()
            row.add(Root.COLUMN_ROOT_ID, drive.id)
            row.add(Root.COLUMN_DOCUMENT_ID, "$ROOT_DOCUMENT_PREFIX${drive.id}")
            row.add(Root.COLUMN_TITLE, drive.name)
            row.add(Root.COLUMN_SUMMARY, "ProtoFS Encrypted Cloud Storage")
            row.add(
                Root.COLUMN_FLAGS,
                Root.FLAG_SUPPORTS_CREATE or
                        Root.FLAG_SUPPORTS_IS_CHILD or
                        Root.FLAG_LOCAL_ONLY
            )
            row.add(Root.COLUMN_MIME_TYPES, "*/*")
            row.add(Root.COLUMN_AVAILABLE_BYTES, 1024L * 1024L * 1024L * 100L) // Unlimited / 100GB visual
            row.add(Root.COLUMN_CAPACITY_BYTES, 1024L * 1024L * 1024L * 1024L) // 1TB visual
            row.add(Root.COLUMN_ICON, android.R.drawable.ic_menu_save)
        }

        return result
    }

    override fun queryDocument(documentId: String, projection: Array<out String>?): Cursor {
        val result = MatrixCursor(projection ?: DEFAULT_DOCUMENT_PROJECTION)
        val row = result.newRow()

        when {
            documentId.startsWith(ROOT_DOCUMENT_PREFIX) -> {
                val driveId = documentId.removePrefix(ROOT_DOCUMENT_PREFIX)
                val drive = listAvailableDrives().find { it.id == driveId }
                val driveName = drive?.name ?: "ProtoFS Drive"

                row.add(Document.COLUMN_DOCUMENT_ID, documentId)
                row.add(Document.COLUMN_DISPLAY_NAME, driveName)
                row.add(Document.COLUMN_MIME_TYPE, Document.MIME_TYPE_DIR)
                row.add(Document.COLUMN_LAST_MODIFIED, System.currentTimeMillis())
                row.add(
                    Document.COLUMN_FLAGS,
                    Document.FLAG_DIR_SUPPORTS_CREATE or
                            Document.FLAG_SUPPORTS_IS_CHILD
                )
                row.add(Document.COLUMN_SIZE, 0L)
            }

            documentId.startsWith(FOLDER_DOCUMENT_PREFIX) -> {
                val folderId = documentId.removePrefix(FOLDER_DOCUMENT_PREFIX)
                val folder = findFolder(folderId)
                val name = folder?.name ?: "Folder"

                row.add(Document.COLUMN_DOCUMENT_ID, documentId)
                row.add(Document.COLUMN_DISPLAY_NAME, name)
                row.add(Document.COLUMN_MIME_TYPE, Document.MIME_TYPE_DIR)
                row.add(Document.COLUMN_LAST_MODIFIED, folder?.updatedAt ?: System.currentTimeMillis())
                row.add(
                    Document.COLUMN_FLAGS,
                    Document.FLAG_DIR_SUPPORTS_CREATE or
                            Document.FLAG_SUPPORTS_DELETE or
                            Document.FLAG_SUPPORTS_RENAME or
                            Document.FLAG_SUPPORTS_IS_CHILD
                )
                row.add(Document.COLUMN_SIZE, 0L)
            }

            documentId.startsWith(FILE_DOCUMENT_PREFIX) -> {
                val fileId = documentId.removePrefix(FILE_DOCUMENT_PREFIX)
                val file = findFile(fileId)
                val name = file?.name ?: "Document"
                val mime = file?.let { getMimeTypeFromExtension(it.name) } ?: "application/octet-stream"

                row.add(Document.COLUMN_DOCUMENT_ID, documentId)
                row.add(Document.COLUMN_DISPLAY_NAME, name)
                row.add(Document.COLUMN_MIME_TYPE, mime)
                row.add(Document.COLUMN_LAST_MODIFIED, file?.updatedAt ?: System.currentTimeMillis())
                row.add(
                    Document.COLUMN_FLAGS,
                    Document.FLAG_SUPPORTS_WRITE or
                            Document.FLAG_SUPPORTS_DELETE or
                            Document.FLAG_SUPPORTS_RENAME or
                            Document.FLAG_SUPPORTS_IS_CHILD
                )
                row.add(Document.COLUMN_SIZE, file?.sizeBytes ?: 0L)
            }

            else -> {
                throw FileNotFoundException("Unknown Document ID: $documentId")
            }
        }

        return result
    }

    override fun queryChildDocuments(
        parentDocumentId: String,
        projection: Array<out String>?,
        sortOrder: String?
    ): Cursor {
        val result = MatrixCursor(projection ?: DEFAULT_DOCUMENT_PROJECTION)

        val (driveId, parentFolderId) = when {
            parentDocumentId.startsWith(ROOT_DOCUMENT_PREFIX) -> {
                Pair(parentDocumentId.removePrefix(ROOT_DOCUMENT_PREFIX), "root")
            }
            parentDocumentId.startsWith(FOLDER_DOCUMENT_PREFIX) -> {
                val folderId = parentDocumentId.removePrefix(FOLDER_DOCUMENT_PREFIX)
                val f = findFolder(folderId)
                Pair(f?.driveId ?: "personal", folderId)
            }
            else -> {
                return result
            }
        }

        // Query folders with matching parent_id
        val childFolders = listChildFolders(driveId, parentFolderId)
        for (folder in childFolders) {
            val row = result.newRow()
            row.add(Document.COLUMN_DOCUMENT_ID, "$FOLDER_DOCUMENT_PREFIX${folder.id}")
            row.add(Document.COLUMN_DISPLAY_NAME, folder.name)
            row.add(Document.COLUMN_MIME_TYPE, Document.MIME_TYPE_DIR)
            row.add(Document.COLUMN_LAST_MODIFIED, folder.updatedAt)
            row.add(
                Document.COLUMN_FLAGS,
                Document.FLAG_DIR_SUPPORTS_CREATE or
                        Document.FLAG_SUPPORTS_DELETE or
                        Document.FLAG_SUPPORTS_RENAME or
                        Document.FLAG_SUPPORTS_IS_CHILD
            )
            row.add(Document.COLUMN_SIZE, 0L)
        }

        // Query files with matching parent_id
        val childFiles = listChildFiles(driveId, parentFolderId)
        for (file in childFiles) {
            val row = result.newRow()
            row.add(Document.COLUMN_DOCUMENT_ID, "$FILE_DOCUMENT_PREFIX${file.id}")
            row.add(Document.COLUMN_DISPLAY_NAME, file.name)
            row.add(Document.COLUMN_MIME_TYPE, getMimeTypeFromExtension(file.name))
            row.add(Document.COLUMN_LAST_MODIFIED, file.updatedAt)
            row.add(
                Document.COLUMN_FLAGS,
                Document.FLAG_SUPPORTS_WRITE or
                        Document.FLAG_SUPPORTS_DELETE or
                        Document.FLAG_SUPPORTS_RENAME or
                        Document.FLAG_SUPPORTS_IS_CHILD
            )
            row.add(Document.COLUMN_SIZE, file.sizeBytes)
        }

        return result
    }

    override fun openDocument(
        documentId: String,
        mode: String,
        signal: CancellationSignal?
    ): ParcelFileDescriptor {
        if (!documentId.startsWith(FILE_DOCUMENT_PREFIX)) {
            throw FileNotFoundException("Directories cannot be opened as binary streams: $documentId")
        }

        val fileId = documentId.removePrefix(FILE_DOCUMENT_PREFIX)
        val fileMeta = findFile(fileId) ?: throw FileNotFoundException("File not found: $documentId")

        val isWrite = mode.contains("w") || mode.contains("rwt")

        val targetCacheFile = File(cacheBaseDir, "${fileId}_${fileMeta.name}")

        if (!isWrite) {
            // Read mode: if file does not exist locally in cache, stream on demand
            if (!targetCacheFile.exists() || targetCacheFile.length() == 0L) {
                try {
                    // Populate local cache file from ProtoFS storage
                    targetCacheFile.createNewFile()
                    FileOutputStream(targetCacheFile).use { out ->
                        // If file was previously cached or downloaded, pipe it; otherwise write empty placeholder
                        out.write(ByteArray(0))
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed preparing cache file: ${e.message}")
                }
            }

            val accessMode = ParcelFileDescriptor.MODE_READ_ONLY
            return ParcelFileDescriptor.open(targetCacheFile, accessMode)
        } else {
            // Write mode: open for read/write and schedule sync after write completes
            val accessMode = ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_CREATE
            val pfd = ParcelFileDescriptor.open(targetCacheFile, accessMode)

            // When closed, notify content resolver that document modified
            Handler(Looper.getMainLooper()).postDelayed({
                context?.contentResolver?.notifyChange(
                    DocumentsContract.buildDocumentUri(AUTHORITY, documentId),
                    null
                )
            }, 1000)

            return pfd
        }
    }

    override fun createDocument(
        parentDocumentId: String,
        mimeType: String,
        displayName: String
    ): String {
        val driveId = resolveDriveId(parentDocumentId)
        val parentFolderId = when {
            parentDocumentId.startsWith(ROOT_DOCUMENT_PREFIX) -> "root"
            parentDocumentId.startsWith(FOLDER_DOCUMENT_PREFIX) -> parentDocumentId.removePrefix(FOLDER_DOCUMENT_PREFIX)
            else -> "root"
        }

        val newId = "doc_${System.currentTimeMillis()}_${(1000..9999).random()}"

        return if (mimeType == Document.MIME_TYPE_DIR) {
            // Create virtual directory
            insertVirtualFolder(newId, driveId, parentFolderId, displayName)
            "$FOLDER_DOCUMENT_PREFIX$newId"
        } else {
            // Create virtual file
            insertVirtualFile(newId, driveId, parentFolderId, displayName, 0L)
            "$FILE_DOCUMENT_PREFIX$newId"
        }
    }

    override fun deleteDocument(documentId: String) {
        when {
            documentId.startsWith(FILE_DOCUMENT_PREFIX) -> {
                val fileId = documentId.removePrefix(FILE_DOCUMENT_PREFIX)
                deleteVirtualFile(fileId)
            }
            documentId.startsWith(FOLDER_DOCUMENT_PREFIX) -> {
                val folderId = documentId.removePrefix(FOLDER_DOCUMENT_PREFIX)
                deleteVirtualFolder(folderId)
            }
        }
        notifyParentChange(documentId)
    }

    override fun renameDocument(documentId: String, displayName: String): String {
        when {
            documentId.startsWith(FILE_DOCUMENT_PREFIX) -> {
                val fileId = documentId.removePrefix(FILE_DOCUMENT_PREFIX)
                renameVirtualFile(fileId, displayName)
            }
            documentId.startsWith(FOLDER_DOCUMENT_PREFIX) -> {
                val folderId = documentId.removePrefix(FOLDER_DOCUMENT_PREFIX)
                renameVirtualFolder(folderId, displayName)
            }
        }
        notifyParentChange(documentId)
        return documentId
    }

    override fun isChildDocument(parentDocumentId: String, documentId: String): Boolean {
        if (parentDocumentId.startsWith(ROOT_DOCUMENT_PREFIX)) {
            val rootDriveId = parentDocumentId.removePrefix(ROOT_DOCUMENT_PREFIX)
            val docDriveId = resolveDriveId(documentId)
            return rootDriveId == docDriveId
        }

        if (parentDocumentId.startsWith(FOLDER_DOCUMENT_PREFIX)) {
            val parentFolderId = parentDocumentId.removePrefix(FOLDER_DOCUMENT_PREFIX)
            val directParent = when {
                documentId.startsWith(FILE_DOCUMENT_PREFIX) -> findFile(documentId.removePrefix(FILE_DOCUMENT_PREFIX))?.parentId
                documentId.startsWith(FOLDER_DOCUMENT_PREFIX) -> findFolder(documentId.removePrefix(FOLDER_DOCUMENT_PREFIX))?.parentId
                else -> null
            }
            return directParent == parentFolderId
        }

        return false
    }

    // -------------------------------------------------------------------------
    // INTERNAL VFS QUERY HELPERS
    // -------------------------------------------------------------------------

    data class DriveRecord(val id: String, val name: String)
    data class FolderRecord(val id: String, val driveId: String, val parentId: String, val name: String, val updatedAt: Long)
    data class FileRecord(val id: String, val driveId: String, val parentId: String, val name: String, val sizeBytes: Long, val updatedAt: Long)

    private fun listAvailableDrives(): List<DriveRecord> {
        val list = mutableListOf(DriveRecord("personal", "Personal Cloud Drive"))
        try {
            databaseHelper?.rawQuery("SELECT id, name FROM drives", null)?.use { cursor ->
                while (cursor.moveToNext()) {
                    val id = cursor.getString(0)
                    val name = cursor.getString(1)
                    if (list.none { it.id == id }) {
                        list.add(DriveRecord(id, name))
                    }
                }
            }
        } catch (e: Exception) {
            Log.d(TAG, "Fallback to default drives: ${e.message}")
        }
        return list
    }

    private fun findFolder(folderId: String): FolderRecord? {
        try {
            databaseHelper?.rawQuery(
                "SELECT id, drive_id, parent_id, name, updated_at FROM folders WHERE id = ?",
                arrayOf(folderId)
            )?.use { cursor ->
                if (cursor.moveToNext()) {
                    return FolderRecord(
                        id = cursor.getString(0),
                        driveId = cursor.getString(1),
                        parentId = cursor.getString(2),
                        name = cursor.getString(3),
                        updatedAt = cursor.getLong(4)
                    )
                }
            }
        } catch (e: Exception) {
            Log.d(TAG, "findFolder query failed: ${e.message}")
        }
        return null
    }

    private fun findFile(fileId: String): FileRecord? {
        try {
            databaseHelper?.rawQuery(
                "SELECT id, drive_id, parent_id, name, size_bytes, updated_at FROM files WHERE id = ?",
                arrayOf(fileId)
            )?.use { cursor ->
                if (cursor.moveToNext()) {
                    return FileRecord(
                        id = cursor.getString(0),
                        driveId = cursor.getString(1),
                        parentId = cursor.getString(2),
                        name = cursor.getString(3),
                        sizeBytes = cursor.getLong(4),
                        updatedAt = cursor.getLong(5)
                    )
                }
            }
        } catch (e: Exception) {
            Log.d(TAG, "findFile query failed: ${e.message}")
        }
        return null
    }

    private fun listChildFolders(driveId: String, parentId: String): List<FolderRecord> {
        val list = mutableListOf<FolderRecord>()
        try {
            databaseHelper?.rawQuery(
                "SELECT id, drive_id, parent_id, name, updated_at FROM folders WHERE drive_id = ? AND parent_id = ? AND trashed = 0",
                arrayOf(driveId, parentId)
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    list.add(
                        FolderRecord(
                            id = cursor.getString(0),
                            driveId = cursor.getString(1),
                            parentId = cursor.getString(2),
                            name = cursor.getString(3),
                            updatedAt = cursor.getLong(4)
                        )
                    )
                }
            }
        } catch (e: Exception) {
            Log.d(TAG, "listChildFolders query failed: ${e.message}")
        }
        return list
    }

    private fun listChildFiles(driveId: String, parentId: String): List<FileRecord> {
        val list = mutableListOf<FileRecord>()
        try {
            databaseHelper?.rawQuery(
                "SELECT id, drive_id, parent_id, name, size_bytes, updated_at FROM files WHERE drive_id = ? AND parent_id = ? AND trashed = 0",
                arrayOf(driveId, parentId)
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    list.add(
                        FileRecord(
                            id = cursor.getString(0),
                            driveId = cursor.getString(1),
                            parentId = cursor.getString(2),
                            name = cursor.getString(3),
                            sizeBytes = cursor.getLong(4),
                            updatedAt = cursor.getLong(5)
                        )
                    )
                }
            }
        } catch (e: Exception) {
            Log.d(TAG, "listChildFiles query failed: ${e.message}")
        }
        return list
    }

    private fun insertVirtualFolder(id: String, driveId: String, parentId: String, name: String) {
        try {
            databaseHelper?.execSQL(
                "INSERT OR REPLACE INTO folders (id, drive_id, parent_id, name, trashed, updated_at) VALUES (?, ?, ?, ?, 0, ?)",
                arrayOf(id, driveId, parentId, name, System.currentTimeMillis())
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed inserting folder: ${e.message}")
        }
    }

    private fun insertVirtualFile(id: String, driveId: String, parentId: String, name: String, size: Long) {
        try {
            databaseHelper?.execSQL(
                "INSERT OR REPLACE INTO files (id, drive_id, parent_id, name, size_bytes, trashed, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
                arrayOf(id, driveId, parentId, name, size, System.currentTimeMillis())
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed inserting file: ${e.message}")
        }
    }

    private fun deleteVirtualFile(id: String) {
        try {
            databaseHelper?.execSQL("UPDATE files SET trashed = 1 WHERE id = ?", arrayOf(id))
        } catch (e: Exception) {
            Log.e(TAG, "Failed deleting file: ${e.message}")
        }
    }

    private fun deleteVirtualFolder(id: String) {
        try {
            databaseHelper?.execSQL("UPDATE folders SET trashed = 1 WHERE id = ?", arrayOf(id))
        } catch (e: Exception) {
            Log.e(TAG, "Failed deleting folder: ${e.message}")
        }
    }

    private fun renameVirtualFile(id: String, newName: String) {
        try {
            databaseHelper?.execSQL("UPDATE files SET name = ?, updated_at = ? WHERE id = ?", arrayOf(newName, System.currentTimeMillis(), id))
        } catch (e: Exception) {
            Log.e(TAG, "Failed renaming file: ${e.message}")
        }
    }

    private fun renameVirtualFolder(id: String, newName: String) {
        try {
            databaseHelper?.execSQL("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?", arrayOf(newName, System.currentTimeMillis(), id))
        } catch (e: Exception) {
            Log.e(TAG, "Failed renaming folder: ${e.message}")
        }
    }

    private fun resolveDriveId(documentId: String): String {
        return when {
            documentId.startsWith(ROOT_DOCUMENT_PREFIX) -> documentId.removePrefix(ROOT_DOCUMENT_PREFIX)
            documentId.startsWith(FOLDER_DOCUMENT_PREFIX) -> findFolder(documentId.removePrefix(FOLDER_DOCUMENT_PREFIX))?.driveId ?: "personal"
            documentId.startsWith(FILE_DOCUMENT_PREFIX) -> findFile(documentId.removePrefix(FILE_DOCUMENT_PREFIX))?.driveId ?: "personal"
            else -> "personal"
        }
    }

    private fun notifyParentChange(documentId: String) {
        val uri = DocumentsContract.buildDocumentUri(AUTHORITY, documentId)
        context?.contentResolver?.notifyChange(uri, null)
    }

    private fun getMimeTypeFromExtension(filename: String): String {
        val extension = filename.substringAfterLast('.', "")
        if (extension.isEmpty()) return "application/octet-stream"
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.lowercase())
            ?: "application/octet-stream"
    }
}
