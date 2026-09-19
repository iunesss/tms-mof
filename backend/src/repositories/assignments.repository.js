/**
 * استعلامات النطاق التنظيمي المشتركة بين لوحة التحكم والدورات والملف الشخصي.
 * لا تأخذ هوية المستخدم من الطلب؛ يستدعيها الـcontroller بهوية req.user.id الموثقة.
 */
async function getAgentSector(connection, agentUserId) {
  const [rows] = await connection.execute(
    `SELECT s.id, s.name, s.code
     FROM sector_agent_assignments a JOIN sectors s ON s.id = a.sector_id
     WHERE a.agent_user_id = ? AND a.end_date IS NULL AND s.deleted_at IS NULL LIMIT 1`,
    [agentUserId]
  );
  return rows[0] || null;
}

async function getManagerDepartment(connection, managerUserId) {
  const [rows] = await connection.execute(
    `SELECT d.id, d.name, d.code, s.id AS sector_id, s.name AS sector_name
     FROM department_manager_assignments a JOIN departments d ON d.id = a.department_id
     JOIN sectors s ON s.id = d.sector_id
     WHERE a.manager_user_id = ? AND a.end_date IS NULL
       AND d.deleted_at IS NULL AND s.deleted_at IS NULL LIMIT 1`,
    [managerUserId]
  );
  return rows[0] || null;
}

module.exports = { getAgentSector, getManagerDepartment };
