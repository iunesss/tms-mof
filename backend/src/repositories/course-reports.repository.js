/** يرفق آخر تقرير نهائي بالدورات التي سبق أن أجازتها خدمة الدور. */
async function attachFinalReports(connection, courses) {
  if (!courses.length) return courses;

  const [reports] = await connection.query(
    `SELECT r.course_id, r.id, f.original_name, f.storage_key
     FROM course_reports r
     JOIN files f ON f.id = r.file_id AND f.deleted_at IS NULL
     WHERE r.course_id IN (?)
       AND r.report_type = 'FINAL_REPORT'
       AND r.deleted_at IS NULL
       AND r.id = (
         SELECT MAX(latest.id) FROM course_reports latest
         WHERE latest.course_id = r.course_id
           AND latest.report_type = 'FINAL_REPORT'
           AND latest.deleted_at IS NULL
       )`,
    [courses.map((course) => course.id)]
  );

  const byCourseId = new Map(reports.map((report) => [Number(report.course_id), report]));
  return courses.map((course) => {
    const report = byCourseId.get(Number(course.id));
    return {
      ...course,
      final_report: report ? {
        id: report.id,
        original_name: report.original_name,
        file_url: `${process.env.API_PUBLIC_URL || 'http://localhost:3000'}/uploads/${report.storage_key}`,
      } : null,
    };
  });
}

module.exports = { attachFinalReports };
